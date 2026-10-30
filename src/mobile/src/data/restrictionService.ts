import type { FormIssue } from './authForms';
import { addDays, isRealDate } from './dates';
import type { RemoteApi, RestrictionItem, RestrictionLevel } from './types';

const NETWORK_MESSAGE = 'Necesitas conexión para cambiar tus restricciones.';

export interface RestrictionInput {
  /** Con id se edita esa restricción; sin id se crea una con un id nuevo generado en el dispositivo. */
  id?: string;
  zone: string;
  avoidedMovements: string[];
  level: RestrictionLevel | null;
  /** AAAA-MM-DD, o vacío si no hay fecha de revisión. */
  reviewOn: string;
}

export type SaveRestrictionOutcome =
  | { kind: 'ok'; item: RestrictionItem }
  | { kind: 'invalid'; issues: FormIssue[] }
  | { kind: 'rejected'; message: string }
  | { kind: 'network'; message: string };

/** AC-profile-001-18: llegó la fecha de revisión (o ya pasó). El nivel no cambia solo. */
export const isDueForReview = (item: RestrictionItem, today: string): boolean =>
  item.reviewOn !== null && today >= item.reviewOn;

/**
 * Restricciones de la persona (P3). Se gestionan con conexión: la API las aplica al asignar ejercicios
 * (SPEC-training-002), así que no hay cola local (SPEC-profile-001, AC-15 y 18).
 */
export class RestrictionService {
  constructor(
    private readonly remote: RemoteApi,
    private readonly newId: () => string,
    private readonly today: () => string,
  ) {}

  /** Null si no hay conexión. */
  list(): Promise<RestrictionItem[] | null> {
    return this.remote.fetchRestrictions();
  }

  async save(input: RestrictionInput): Promise<SaveRestrictionOutcome> {
    const issues: FormIssue[] = [];
    if (input.zone.trim() === '') issues.push({ field: 'zone', message: 'Elige la zona.' });
    if (input.level === null) issues.push({ field: 'level', message: 'Elige el nivel.' });

    const reviewOn = input.reviewOn.trim();
    if (reviewOn !== '') {
      // Un día de margen por las zonas horarias, como la API.
      if (!isRealDate(reviewOn)) issues.push({ field: 'reviewOn', message: 'La fecha de revisión debe tener el formato AAAA-MM-DD.' });
      else if (reviewOn < addDays(this.today(), -1)) issues.push({ field: 'reviewOn', message: 'La fecha de revisión no puede ser anterior a hoy.' });
    }
    if (issues.length > 0) return { kind: 'invalid', issues };

    const item: RestrictionItem = {
      id: input.id ?? this.newId(),
      zone: input.zone.trim(),
      avoidedMovements: input.avoidedMovements,
      level: input.level as RestrictionLevel,
      reviewOn: reviewOn === '' ? null : reviewOn,
    };
    const result = await this.remote.putRestriction(item);
    if (result.kind === 'ok') return { kind: 'ok', item };
    if (result.kind === 'rejected') return { kind: 'rejected', message: result.reason };
    return { kind: 'network', message: NETWORK_MESSAGE };
  }

  async remove(id: string): Promise<'ok' | { kind: 'network'; message: string }> {
    return (await this.remote.deleteRestriction(id)) === 'ok' ? 'ok' : { kind: 'network', message: NETWORK_MESSAGE };
  }
}
