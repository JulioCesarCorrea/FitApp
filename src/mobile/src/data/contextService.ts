// Contexto personal (SPEC-profile-002): suplementos, hábitos, medicación y notas. Funciona sin conexión: se guarda en el teléfono con un
// id del dispositivo y se envía cuando hay red. La IA nunca escribe aquí; el resumen para la IA lo calcula la API.

import {
  CONTEXT_FREQUENCIES, CONTEXT_TYPES, isActive, looksPersonal, MAX_ACTIVE, MAX_BRAND, MAX_DOSE, MAX_NAME, MAX_NOTE,
} from './contextRules';
import { localDate } from './nutritionService';
import type { LocalContextItem, LocalStore, PutLogResult, ServerContextItem } from './types';

export interface ContextApi {
  fetchContextItems(): Promise<ServerContextItem[] | null>;
  putContextItem(item: ServerContextItem): Promise<PutLogResult>;
  deleteContextItem(id: string): Promise<'ok' | 'retry'>;
}

export interface RawContextInput {
  type: string;
  name: string;
  brand: string;
  dose: string;
  frequency: string;
  startedOn: string;
  endedOn: string;
  note: string;
  shareWithAi: boolean;
}

export interface ContextIssue {
  field: string;
  message: string;
}

export type SaveContextResult = { ok: true; item: LocalContextItem } | { ok: false; issues: ContextIssue[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isRealDate = (value: string) => ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
const visible = (i: LocalContextItem) => i.pendingOp !== 'delete';
const body = (i: LocalContextItem | ServerContextItem) =>
  JSON.stringify([i.type, i.name, i.brand, i.dose, i.frequency, i.startedOn, i.endedOn, i.note, i.shareWithAi]);

export class ContextService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LocalStore,
    private readonly remote: ContextApi,
    private readonly newId: () => string,
    private readonly today: () => string = localDate,
  ) {}

  /** AC-12: todas (activas y de baja) ordenadas por tipo y nombre, también las que esperan envío. */
  async list(): Promise<LocalContextItem[]> {
    const order = (t: string) => CONTEXT_TYPES.indexOf(t as (typeof CONTEXT_TYPES)[number]);
    return (await this.store.getContextItems()).filter(visible)
      .sort((a, b) => order(a.type) - order(b.type) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** AC-01 a 04, 08, 12 y 13: valida con las mismas reglas que la API, guarda en local y envía si hay conexión. */
  async save(raw: RawContextInput, existingId?: string): Promise<SaveContextResult> {
    const issues: ContextIssue[] = [];
    const name = raw.name.trim();
    const brand = orNull(raw.brand);
    const dose = orNull(raw.dose);
    const frequency = orNull(raw.frequency);
    const note = orNull(raw.note);
    const startedOn = orNull(raw.startedOn);
    const endedOn = orNull(raw.endedOn);

    if (!(CONTEXT_TYPES as readonly string[]).includes(raw.type)) issues.push({ field: 'type', message: 'Elige un tipo.' });
    if (name === '') issues.push({ field: 'name', message: 'El nombre es obligatorio.' });
    else if (name.length > MAX_NAME) issues.push({ field: 'name', message: `El nombre admite hasta ${MAX_NAME} caracteres.` });
    if (brand && brand.length > MAX_BRAND) issues.push({ field: 'brand', message: `La marca admite hasta ${MAX_BRAND} caracteres.` });
    if (dose && dose.length > MAX_DOSE) issues.push({ field: 'dose', message: `La dosis admite hasta ${MAX_DOSE} caracteres.` });
    if (note && note.length > MAX_NOTE) issues.push({ field: 'note', message: `La nota admite hasta ${MAX_NOTE} caracteres.` });
    if (frequency && !(CONTEXT_FREQUENCIES as readonly string[]).includes(frequency)) issues.push({ field: 'frequency', message: 'Elige una frecuencia de la lista.' });
    if (startedOn && !isRealDate(startedOn)) issues.push({ field: 'startedOn', message: 'El inicio debe ser una fecha AAAA-MM-DD.' });
    if (endedOn && !isRealDate(endedOn)) issues.push({ field: 'endedOn', message: 'La baja debe ser una fecha AAAA-MM-DD.' });
    if (startedOn && endedOn && isRealDate(startedOn) && isRealDate(endedOn) && endedOn < startedOn) {
      issues.push({ field: 'endedOn', message: 'La baja no puede ser anterior al inicio.' });
    }
    if (raw.type === 'nota') {
      if (dose || frequency) issues.push({ field: 'note', message: 'Una nota no lleva dosis ni frecuencia.' });
      if (looksPersonal(name) || looksPersonal(note)) issues.push({ field: 'note', message: 'No escribas correos, teléfonos ni enlaces en una nota.' });
    }

    const existing = existingId ? await this.store.getContextItem(existingId) : null;
    if (!existing && isActive(endedOn, this.today())) {
      const active = (await this.store.getContextItems()).filter((i) => visible(i) && isActive(i.endedOn, this.today())).length;
      if (active >= MAX_ACTIVE) issues.push({ field: 'name', message: `Tienes el máximo de ${MAX_ACTIVE} entradas activas. Da de baja alguna.` });
    }
    if (issues.length > 0) return { ok: false, issues };

    const item: LocalContextItem = {
      id: existing?.id ?? existingId ?? this.newId(), type: raw.type, name, brand, dose, frequency, startedOn, endedOn, note,
      // AC-03: la medicación nunca se comparte.
      shareWithAi: raw.type === 'medicacion' ? false : raw.shareWithAi,
      status: 'pending', message: null, pendingOp: 'upsert', attempted: false,
    };
    await this.store.saveContextItem(item);
    await this.syncPending();
    return { ok: true, item: (await this.store.getContextItem(item.id)) ?? item };
  }

  /** AC-06: dar de baja conserva la entrada (con la fecha de hoy deja de contar como activa). */
  async end(id: string): Promise<void> {
    const item = await this.store.getContextItem(id);
    if (!item) return;
    await this.store.saveContextItem({ ...item, endedOn: this.today(), status: 'pending', message: null, pendingOp: 'upsert', attempted: false });
    await this.syncPending();
  }

  /** Volver a activar una entrada dada de baja. */
  async reactivate(id: string): Promise<void> {
    const item = await this.store.getContextItem(id);
    if (!item) return;
    const active = (await this.store.getContextItems()).filter((i) => visible(i) && isActive(i.endedOn, this.today())).length;
    if (active >= MAX_ACTIVE) return;
    await this.store.saveContextItem({ ...item, endedOn: null, status: 'pending', message: null, pendingOp: 'upsert', attempted: false });
    await this.syncPending();
  }

  /** Borrar del todo; si aún no llegó a la API se descarta sin más. */
  async remove(id: string): Promise<void> {
    const item = await this.store.getContextItem(id);
    if (!item) return;
    if (item.pendingOp === 'upsert' && !item.attempted) {
      await this.store.deleteContextItem(id);
      return;
    }
    await this.store.saveContextItem({ ...item, status: 'pending', message: null, pendingOp: 'delete' });
    await this.syncPending();
  }

  /** Descarta una entrada que la API rechazó (queda fuera de la lista). */
  async discard(id: string): Promise<void> {
    await this.store.deleteContextItem(id);
  }

  /** AC-13: trae lo que dice la API si no hay nada pendiente. */
  async refresh(): Promise<void> {
    await this.syncPending();
    const all = await this.store.getContextItems();
    if (all.every((i) => i.status === 'synced' && i.pendingOp === null)) {
      const served = await this.remote.fetchContextItems();
      if (served) await this.store.replaceSyncedContextItems(served);
    }
  }

  syncPending(): Promise<void> {
    const run = this.chain.then(() => this.doSync());
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async doSync(): Promise<void> {
    const pending = await this.store.getPendingContextItems();
    for (const item of pending.filter((i) => i.pendingOp === 'upsert')) if (!(await this.send(item))) return;
    for (const item of pending.filter((i) => i.pendingOp === 'delete')) {
      if ((await this.remote.deleteContextItem(item.id)) === 'retry') return;
      await this.store.deleteContextItem(item.id);
    }
  }

  private async send(item: LocalContextItem): Promise<boolean> {
    const sending = { ...item, attempted: true };
    await this.store.saveContextItem(sending);
    const result = await this.remote.putContextItem({
      id: sending.id, type: sending.type, name: sending.name, brand: sending.brand, dose: sending.dose, frequency: sending.frequency,
      startedOn: sending.startedOn, endedOn: sending.endedOn, note: sending.note, shareWithAi: sending.shareWithAi,
    });
    if (result.kind === 'retry') return false;

    const current = await this.store.getContextItem(item.id);
    if (!current || current.pendingOp !== 'upsert' || body(current) !== body(sending)) return true; // cambió mientras se enviaba: se reenvía luego
    await this.store.saveContextItem(
      result.kind === 'ok'
        ? { ...current, status: 'synced', message: null, pendingOp: null }
        : { ...current, status: 'rejected', message: result.reason },
    );
    return true;
  }
}
