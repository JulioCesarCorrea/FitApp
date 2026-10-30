import { parseKg } from './format';
import {
  CEILING_REPS,
  DEFAULT_THRESHOLD,
  advise,
  checkStagnation,
  evaluateFirstSet,
  loadsFor,
  type FirstSetEvaluation,
  type LoadAdvice,
  type StagnationResult,
} from './progression';
import type { CatalogExercise, LocalExerciseLog, LocalStore, RemoteApi, ServerExerciseLog, SyncStatus } from './types';

export const MAX_LOAD_KG = 1000;
export const MIN_THRESHOLD = 2;
export const MAX_THRESHOLD = 10;
const EARLIEST_DATE = '2000-01-01';
const THRESHOLD_KEY = 'stagnationThreshold';
const THRESHOLD_STATUS_KEY = 'stagnationThresholdStatus';
const THRESHOLD_MESSAGE_KEY = 'stagnationThresholdMessage';

/** Lo que escribe la persona en el formulario, sin interpretar. */
export interface RawLogInput {
  date: string;
  load: string;
  first: string;
  second: string;
  assisted: string;
}

export interface LogDraft {
  exerciseId: string;
  date: string;
  loadKg: number;
  firstSetReps: number;
  secondSetReps: number;
  secondSetAssistedReps: number;
}

export interface LogIssue {
  field: 'date' | 'load' | 'first' | 'second' | 'assisted';
  message: string;
}

export type ParseResult = { ok: true; draft: LogDraft } | { ok: false; issues: LogIssue[] };

export type SaveResult =
  | { ok: true; log: LocalExerciseLog }
  | { ok: false; issues: LogIssue[]; /** Registro del mismo ejercicio y fecha, para ofrecer editarlo. */ duplicateOf?: string };

export interface SessionAdvice {
  advice: LoadAdvice;
  firstSetEvaluation: FirstSetEvaluation;
  stagnation: StagnationResult;
  /** Falta el perfil de equipamiento: la persona debe configurarlo para recibir cargas. */
  needsEquipment: boolean;
}

export interface LogOutcome {
  id: string;
  kind: 'ok' | 'rejected' | 'retry';
}

/** Resultado de «Sincronizar ahora»: cuántos cambios se enviaron y cuántos siguen pendientes. */
export interface SyncReport {
  sent: number;
  pending: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Día local en formato AAAA-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isRealDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function addDays(text: string, days: number): string {
  const [y, mo, d] = text.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** Entero escrito en el formulario; vacío vale null y cualquier otra cosa que no sea entero, NaN. */
function parseInteger(text: string): number | null {
  const t = text.trim();
  if (t === '') return null;
  return /^-?\d+$/.test(t) ? Number(t) : Number.NaN;
}

/**
 * Valida el formulario con los mismos límites que la API (SPEC-training-003, AC-03 y AC-05).
 * En peso corporal la carga es el lastre: puede ser 0 o quedar vacía.
 */
export function parseDraft(exercise: CatalogExercise, raw: RawLogInput, today: string): ParseResult {
  const issues: LogIssue[] = [];
  const bodyweight = exercise.equipment === 'PesoCorporal';

  const date = raw.date.trim();
  if (!isRealDate(date)) issues.push({ field: 'date', message: 'La fecha debe tener el formato AAAA-MM-DD.' });
  else if (date < EARLIEST_DATE) issues.push({ field: 'date', message: 'La fecha no es válida.' });
  // Un día de margen por las zonas horarias, como la API.
  else if (date > addDays(today, 1)) issues.push({ field: 'date', message: 'La fecha no puede ser futura.' });

  let loadKg = 0;
  const load = parseKg(raw.load);
  if (load === 'invalid' || (load === null && !bodyweight)) {
    issues.push({ field: 'load', message: 'La carga debe ser un número.' });
  } else if (load !== null) {
    if (load < 0 || load > MAX_LOAD_KG) {
      issues.push({ field: 'load', message: `La carga debe estar entre 0 y ${MAX_LOAD_KG} kg.` });
    } else if (Math.abs(Math.round(load * 100) - load * 100) > 1e-6) {
      issues.push({ field: 'load', message: 'La carga admite como máximo 2 decimales.' });
    } else if (load === 0 && !bodyweight) {
      issues.push({ field: 'load', message: 'La carga debe ser mayor que 0 kg.' });
    } else {
      loadKg = Math.round(load * 100) / 100;
    }
  }

  const first = parseInteger(raw.first);
  if (first === null || !Number.isInteger(first) || first < 1 || first > CEILING_REPS) {
    issues.push({ field: 'first', message: `La serie 1 lleva entre 1 y ${CEILING_REPS} repeticiones.` });
  }

  const second = parseInteger(raw.second);
  if (second === null || !Number.isInteger(second) || second < 1) {
    issues.push({ field: 'second', message: 'La serie 2 necesita al menos 1 repetición propia.' });
  }

  const assisted = parseInteger(raw.assisted) ?? 0; // vacío = sin ayuda
  if (!Number.isInteger(assisted) || assisted < 0) {
    issues.push({ field: 'assisted', message: 'Las repeticiones asistidas no pueden ser negativas.' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    draft: {
      exerciseId: exercise.id, date, loadKg,
      firstSetReps: first as number, secondSetReps: second as number, secondSetAssistedReps: assisted,
    },
  };
}

const toServer = (l: LocalExerciseLog): ServerExerciseLog => ({
  id: l.id, exerciseId: l.exerciseId, date: l.date, loadKg: l.loadKg,
  firstSetReps: l.firstSetReps, secondSetReps: l.secondSetReps, secondSetAssistedReps: l.secondSetAssistedReps,
});

const sameData = (a: LocalExerciseLog, b: LocalExerciseLog): boolean =>
  JSON.stringify(toServer(a)) === JSON.stringify(toServer(b));

const isVisible = (l: LocalExerciseLog): boolean => l.pendingOp !== 'delete';

/**
 * Registro de sesiones con soporte sin conexión (SPEC-mobile-003, P2).
 * Todo cambio se guarda primero en el teléfono con ids generados en el dispositivo; luego se intenta enviar.
 * Lo que no se pueda enviar queda `pending` y se reintenta con los mismos ids.
 */
export class SessionService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LocalStore,
    private readonly remote: RemoteApi,
    private readonly newId: () => string,
    private readonly today: () => string = () => todayLocal(),
  ) {}

  /** AC-mobile-003-01, 02, 04, 08: crea el registro, o reemplaza el que tiene `existingId`, y lo intenta enviar. */
  async save(exercise: CatalogExercise, raw: RawLogInput, existingId?: string): Promise<SaveResult> {
    const parsed = parseDraft(exercise, raw, this.today());
    if (!parsed.ok) return { ok: false, issues: parsed.issues };

    const rows = await this.store.getLogs(exercise.id);
    const duplicate = rows.find((r) => isVisible(r) && r.date === parsed.draft.date && r.id !== existingId);
    if (duplicate) {
      return {
        ok: false,
        issues: [{ field: 'date', message: 'Ya hay un registro de este ejercicio en esa fecha. Edítalo en lugar de crear otro.' }],
        duplicateOf: duplicate.id,
      };
    }

    const existing = existingId ? await this.store.getLog(existingId) : null;
    const log: LocalExerciseLog = {
      ...parsed.draft,
      id: existingId ?? this.newId(),
      status: 'pending',
      message: null,
      pendingOp: 'upsert',
      attempted: existing?.attempted ?? false,
    };
    await this.store.saveLog(log);
    await this.syncPending();
    return { ok: true, log: (await this.store.getLog(log.id)) ?? log };
  }

  /**
   * AC-mobile-003-05: desaparece del historial de inmediato. Si nunca se intentó enviar no se envía nada;
   * si ya se intentó (aunque no se sepa si llegó), se envía DELETE, que la API acepta siempre.
   */
  async remove(id: string): Promise<void> {
    const row = await this.store.getLog(id);
    if (!row) return;
    if (!row.attempted) {
      await this.store.deleteLog(id);
      return;
    }
    await this.store.saveLog({ ...row, status: 'pending', message: null, pendingOp: 'delete' });
    await this.syncPending();
  }

  /** AC-mobile-003-07: descarta un cambio rechazado; al abrir el historial vuelve la versión del servidor, si la hay. */
  async discard(id: string): Promise<void> {
    await this.store.deleteLog(id);
  }

  /** AC-mobile-003-03 y 06: envía lo pendiente, primero los borrados; se detiene ante un error de red. */
  syncPending(): Promise<LogOutcome[]> {
    const run = this.chain.then(() => this.doSync());
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** AC-mobile-003-16: envía lo pendiente y cuenta lo enviado y lo que sigue pendiente (los rechazados no cuentan). */
  async syncReport(): Promise<SyncReport> {
    const outcomes = await this.syncPending();
    const pending = (await this.store.getPendingLogs()).length;
    return { sent: outcomes.filter((o) => o.kind === 'ok').length, pending };
  }

  private async doSync(): Promise<LogOutcome[]> {
    const pending = await this.store.getPendingLogs();
    const byDate = (a: LocalExerciseLog, b: LocalExerciseLog) => a.date.localeCompare(b.date);
    const ordered = [
      ...pending.filter((l) => l.pendingOp === 'delete').sort(byDate),
      ...pending.filter((l) => l.pendingOp === 'upsert').sort(byDate),
    ];

    const outcomes: LogOutcome[] = [];
    for (const log of ordered) {
      if (log.pendingOp === 'delete') {
        if ((await this.remote.deleteLog(log.id)) === 'retry') {
          outcomes.push({ id: log.id, kind: 'retry' });
          break;
        }
        await this.store.deleteLog(log.id);
        outcomes.push({ id: log.id, kind: 'ok' });
        continue;
      }

      // Se marca como intentado antes de enviar: si la app se cierra a mitad, puede haber llegado.
      const sending = { ...log, attempted: true };
      await this.store.saveLog(sending);
      const result = await this.remote.putLog(toServer(sending));
      if (result.kind === 'retry') {
        outcomes.push({ id: log.id, kind: 'retry' });
        break;
      }

      // Si mientras se enviaba la persona lo editó o lo borró, ese cambio se envía en la siguiente pasada.
      const current = await this.store.getLog(log.id);
      if (!current || current.pendingOp !== 'upsert' || !sameData(current, sending)) {
        outcomes.push({ id: log.id, kind: result.kind });
        continue;
      }
      await this.store.saveLog(
        result.kind === 'ok'
          ? { ...current, status: 'synced', message: null, pendingOp: null }
          : { ...current, status: 'rejected', message: result.reason },
      );
      outcomes.push({ id: log.id, kind: result.kind });
    }
    return outcomes;
  }

  /**
   * AC-mobile-003-12: historial del ejercicio, de la sesión más reciente a la más antigua. Con conexión y sin
   * cambios pendientes ni rechazados de ese ejercicio, se reemplaza por el del servidor (la API es la fuente de verdad).
   */
  async loadHistory(exerciseId: string): Promise<LocalExerciseLog[]> {
    await this.syncPending();
    let rows = await this.store.getLogs(exerciseId);
    if (rows.every((r) => r.status === 'synced' && r.pendingOp === null)) {
      const server = await this.remote.fetchHistory(exerciseId);
      if (server) {
        await this.store.replaceSyncedLogs(exerciseId, server);
        rows = await this.store.getLogs(exerciseId);
      }
    }
    return rows.filter(isVisible).sort((a, b) => b.date.localeCompare(a.date));
  }

  /** AC-mobile-003-09 y 10: consejo de carga y estancamiento calculados en el teléfono. Null sin registros. */
  async getAdvice(exercise: CatalogExercise): Promise<SessionAdvice | null> {
    const rows = (await this.store.getLogs(exercise.id))
      .filter((r) => isVisible(r) && r.status !== 'rejected')
      .sort((a, b) => a.date.localeCompare(b.date));
    if (rows.length === 0) return null;

    const last = rows[rows.length - 1];
    const bodyweight = exercise.equipment === 'PesoCorporal';
    const profile = (await this.store.getEquipment()).profile;

    let advice: LoadAdvice;
    if (bodyweight) {
      advice = { action: 'mantener', nextLoadKg: last.loadKg, missingLoadData: false };
    } else {
      // El escalón propio de la máquina que la persona puso en su rutina, si lo hay.
      const step = (await this.store.getDays())
        .flatMap((d) => d.entries)
        .find((e) => e.exerciseId === exercise.id && e.machineStepKg !== null)?.machineStepKg ?? null;
      const loads = profile ? loadsFor(profile, exercise.equipment, exercise.bar, step) : [];
      advice = advise(last, loads);
    }

    return {
      advice,
      firstSetEvaluation: evaluateFirstSet(last.firstSetReps),
      stagnation: checkStagnation(rows, await this.getThreshold()),
      needsEquipment: !bodyweight && profile === null,
    };
  }

  /** AC-mobile-003-11: umbral de estancamiento de la persona (3 por defecto). */
  async getThreshold(): Promise<number> {
    const stored = await this.store.getSetting(THRESHOLD_KEY);
    const n = stored === null ? Number.NaN : Number(stored);
    return Number.isInteger(n) ? n : DEFAULT_THRESHOLD;
  }

  async getThresholdStatus(): Promise<{ status: SyncStatus; message: string | null }> {
    const status = (await this.store.getSetting(THRESHOLD_STATUS_KEY)) as SyncStatus | null;
    const message = (await this.store.getSetting(THRESHOLD_MESSAGE_KEY)) || null;
    return { status: status ?? 'synced', message };
  }

  /** Guarda el umbral en el teléfono (se usa de inmediato) y lo intenta enviar. Acepta 2 a 10. */
  async setThreshold(input: string | number): Promise<{ ok: true; value: number } | { ok: false; message: string }> {
    const text = String(input).trim();
    const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    if (!(value >= MIN_THRESHOLD && value <= MAX_THRESHOLD)) {
      return { ok: false, message: `El umbral debe ser un número entero entre ${MIN_THRESHOLD} y ${MAX_THRESHOLD}.` };
    }

    await this.store.setSetting(THRESHOLD_KEY, String(value));
    await this.store.setSetting(THRESHOLD_STATUS_KEY, 'pending');
    await this.store.setSetting(THRESHOLD_MESSAGE_KEY, '');
    await this.syncSettings();
    return { ok: true, value };
  }

  async syncSettings(): Promise<void> {
    if ((await this.getThresholdStatus()).status !== 'pending') return;

    const result = await this.remote.putTrainingSettings(await this.getThreshold());
    if (result.kind === 'ok') {
      await this.store.setSetting(THRESHOLD_STATUS_KEY, 'synced');
    } else if (result.kind === 'rejected') {
      await this.store.setSetting(THRESHOLD_STATUS_KEY, 'rejected');
      await this.store.setSetting(THRESHOLD_MESSAGE_KEY, result.reason);
    }
  }

  /** Con conexión y sin un cambio propio por enviar, toma el umbral del servidor. */
  async hydrateSettings(): Promise<void> {
    const { status } = await this.getThresholdStatus();
    if (status === 'pending' || status === 'rejected') return;

    const server = await this.remote.fetchTrainingSettings();
    if (server !== null) {
      await this.store.setSetting(THRESHOLD_KEY, String(server));
      await this.store.setSetting(THRESHOLD_STATUS_KEY, 'synced');
    }
  }
}
