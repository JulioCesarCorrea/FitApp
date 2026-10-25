import {
  DAYS,
  type CatalogSection,
  type DayKey,
  type DayState,
  type EquipmentProfile,
  type LocalPlanEntry,
  type LocalStore,
  type PutDayResult,
  type RemoteApi,
  type RestrictionHit,
} from './types';

export interface DayOutcome {
  day: DayKey;
  result: PutDayResult | null; // null: el día no estaba pendiente
}

export interface EquipmentIssue {
  field: string;
  message: string;
}

/** Valida el perfil de equipamiento antes de guardarlo (AC-mobile-002-04): valores mayores que cero. */
export function validateEquipment(p: EquipmentProfile): EquipmentIssue[] {
  const issues: EquipmentIssue[] = [];
  if (p.dumbbellsKg.some((v) => !(v > 0))) issues.push({ field: 'dumbbellsKg', message: 'Cada mancuerna debe pesar más de 0 kg.' });
  if (p.discsKg.some((v) => !(v > 0))) issues.push({ field: 'discsKg', message: 'Cada disco debe pesar más de 0 kg.' });
  if (Object.values(p.barsKg).some((v) => !(v > 0))) issues.push({ field: 'barsKg', message: 'Cada barra debe pesar más de 0 kg.' });
  if (!(p.machineStepKg > 0)) issues.push({ field: 'machineStepKg', message: 'El escalón de las máquinas debe ser mayor que 0.' });
  if (p.machineBaseKg < 0) issues.push({ field: 'machineBaseKg', message: 'La carga base no puede ser negativa.' });
  return issues;
}

/** Texto legible de los ejercicios que chocan con una restricción. */
export function describeHits(hits: RestrictionHit[]): string {
  return hits.map((h) => `${h.exerciseName} (${h.zones.join(', ')})`).join('; ');
}

/**
 * Rutina y perfil de equipamiento con soporte sin conexión (P2, AC-mobile-002-03..08).
 * Todo cambio se guarda primero en el almacén local con ids generados en el dispositivo; luego se
 * intenta enviar. Lo que no se pueda enviar queda `pending` y se reintenta con los mismos ids.
 */
export class PlanService {
  constructor(
    private readonly store: LocalStore,
    private readonly remote: RemoteApi,
    private readonly newId: () => string,
  ) {}

  /** AC-mobile-002-08: devuelve el catálogo guardado, o lo descarga la primera vez. */
  async loadCatalog(): Promise<{ sections: CatalogSection[] | null; needsConnection: boolean }> {
    const fresh = await this.remote.fetchCatalog();
    if (fresh) {
      await this.store.saveCatalog(fresh);
      return { sections: fresh, needsConnection: false };
    }
    const cached = await this.store.getCatalog();
    return { sections: cached, needsConnection: cached === null };
  }

  getDays(): Promise<DayState[]> {
    return this.store.getDays();
  }

  /** AC-mobile-002-11: días de la rutina en los que ya está este ejercicio. */
  async daysWithExercise(exerciseId: string): Promise<DayKey[]> {
    return (await this.store.getDays())
      .filter((d) => d.entries.some((e) => e.exerciseId === exerciseId))
      .map((d) => d.day);
  }

  /**
   * AC-mobile-002-03: añade el ejercicio al final de cada día elegido y lo intenta enviar.
   * AC-mobile-002-11: un ejercicio solo puede estar una vez por día; los días donde ya está se omiten.
   */
  async assign(exerciseId: string, requestedDays: DayKey[], machineStepKg: number | null = null): Promise<DayOutcome[]> {
    if (machineStepKg !== null && !(machineStepKg > 0)) throw new Error('El escalón debe ser mayor que 0.');

    const taken = new Set(await this.daysWithExercise(exerciseId));
    const days = requestedDays.filter((d) => !taken.has(d));
    if (days.length === 0) return [];

    const current = new Map((await this.store.getDays()).map((d) => [d.day, d]));
    for (const day of days) {
      const entries = current.get(day)?.entries ?? [];
      const next: LocalPlanEntry = { id: this.newId(), exerciseId, order: entries.length, machineStepKg };
      await this.store.saveDay(day, [...entries, next]);
    }
    return this.syncDays(days);
  }

  /** AC-mobile-002-06: quitar un ejercicio de un día. */
  async remove(day: DayKey, entryId: string): Promise<DayOutcome[]> {
    const entries = await this.entriesOf(day);
    await this.store.saveDay(day, reorder(entries.filter((e) => e.id !== entryId)));
    return this.syncDays([day]);
  }

  /** AC-mobile-002-06: subir (-1) o bajar (+1) un ejercicio dentro del día. */
  async move(day: DayKey, entryId: string, direction: -1 | 1): Promise<DayOutcome[]> {
    const entries = [...(await this.entriesOf(day))].sort((a, b) => a.order - b.order);
    const from = entries.findIndex((e) => e.id === entryId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= entries.length) return [];

    [entries[from], entries[to]] = [entries[to], entries[from]];
    await this.store.saveDay(day, reorder(entries));
    return this.syncDays([day]);
  }

  /** La persona confirma el aviso de restricciones de un día: se reenvía con confirmación. */
  async confirmDay(day: DayKey): Promise<DayOutcome> {
    const entries = await this.entriesOf(day);
    const result = await this.remote.putDay(day, entries, true);
    await this.apply(day, result);
    return { day, result };
  }

  /** Envía los días pendientes en orden semanal; se detiene ante un error recuperable. */
  async syncPending(): Promise<DayOutcome[]> {
    const pending = (await this.store.getDays()).filter((d) => d.status === 'pending').map((d) => d.day);
    return this.syncDays(pending);
  }

  /** Con conexión y sin cambios pendientes, trae la rutina y el perfil del servidor. */
  async hydrate(): Promise<void> {
    const days = await this.store.getDays();
    if (days.every((d) => d.status === 'synced')) {
      const plan = await this.remote.fetchPlan();
      if (plan) {
        const served = new Set(plan.map((p) => p.day));
        for (const p of plan) await this.store.replaceDaySynced(p.day, p.entries);
        for (const d of days) if (!served.has(d.day)) await this.store.replaceDaySynced(d.day, []);
      }
    }

    const equipment = await this.store.getEquipment();
    if (equipment.status === 'synced' || equipment.profile === null) {
      const profile = await this.remote.fetchEquipment();
      if (profile && profile !== 'none') {
        await this.store.saveEquipment(profile);
        await this.store.setEquipmentStatus('synced', null);
      }
    }
  }

  /** AC-mobile-002-04: guarda el perfil en el teléfono y lo envía. */
  async saveEquipment(profile: EquipmentProfile): Promise<{ issues: EquipmentIssue[]; status: string }> {
    const issues = validateEquipment(profile);
    if (issues.length > 0) return { issues, status: 'invalid' };

    await this.store.saveEquipment(profile);
    const result = await this.remote.putEquipment(profile);
    if (result.kind === 'ok') await this.store.setEquipmentStatus('synced', null);
    else if (result.kind === 'rejected') await this.store.setEquipmentStatus('rejected', result.reason);
    return { issues: [], status: result.kind };
  }

  async syncEquipment(): Promise<void> {
    const state = await this.store.getEquipment();
    if (state.status !== 'pending' || !state.profile) return;
    const result = await this.remote.putEquipment(state.profile);
    if (result.kind === 'ok') await this.store.setEquipmentStatus('synced', null);
    else if (result.kind === 'rejected') await this.store.setEquipmentStatus('rejected', result.reason);
  }

  private async entriesOf(day: DayKey): Promise<LocalPlanEntry[]> {
    return (await this.store.getDays()).find((d) => d.day === day)?.entries ?? [];
  }

  private async syncDays(days: DayKey[]): Promise<DayOutcome[]> {
    const ordered = DAYS.filter((d) => days.includes(d));
    const outcomes: DayOutcome[] = [];
    for (const day of ordered) {
      const entries = await this.entriesOf(day);
      const result = await this.remote.putDay(day, entries, false);
      await this.apply(day, result);
      outcomes.push({ day, result });
      if (result.kind === 'retry') break; // conserva el orden y no insiste con una red caída
    }
    return outcomes;
  }

  private async apply(day: DayKey, result: PutDayResult): Promise<void> {
    switch (result.kind) {
      case 'ok':
        await this.store.setDayStatus(day, 'synced', null);
        break;
      case 'warnings':
        await this.store.setDayStatus(day, 'needs_confirmation', describeHits(result.hits));
        break;
      case 'blocked':
        await this.store.setDayStatus(day, 'rejected', `Bloqueado por una restricción: ${describeHits(result.hits)}`);
        break;
      case 'rejected':
        await this.store.setDayStatus(day, 'rejected', result.reason);
        break;
      case 'retry':
        break; // sigue pending
    }
  }
}

function reorder(entries: LocalPlanEntry[]): LocalPlanEntry[] {
  return entries.map((e, i) => ({ ...e, order: i }));
}
