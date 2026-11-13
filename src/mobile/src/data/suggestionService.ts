import type { PlanService } from './planService';
import type { Suggestion, SuggestionsApi } from './types';

export type SuggestionsResult = { status: 'ok'; items: Suggestion[] } | { status: 'offline' };

export type AcceptResult = { ok: true } | { ok: false; message: string };

/**
 * Sugerencias de rutina y de corrección del método (SPEC-training-005). Las calcula la API con lo que ya está
 * sincronizado, así que necesitan conexión y no se guardan en el teléfono (AC-training-005-16).
 */
export class SuggestionService {
  constructor(
    private readonly api: SuggestionsApi,
    private readonly plan: Pick<PlanService, 'hydrate'>,
  ) {}

  /** AC-training-005-15 y 16: la lista vigente o «sin conexión». */
  async list(): Promise<SuggestionsResult> {
    const items = await this.api.fetchSuggestions();
    return items === null ? { status: 'offline' } : { status: 'ok', items };
  }

  /** AC-training-005-15: sustituye el ejercicio en la API y trae la rutina actualizada al teléfono. */
  async accept(suggestion: Suggestion, replacementExerciseId: string): Promise<AcceptResult> {
    const result = await this.api.acceptSuggestion(suggestion.key, replacementExerciseId);
    if (result.kind === 'ok') {
      await this.plan.hydrate();
      return { ok: true };
    }
    return {
      ok: false,
      message: result.kind === 'rejected'
        ? result.reason
        : 'Sin conexión: no se pudo aplicar el cambio. Inténtalo de nuevo con conexión.',
    };
  }

  /** AC-training-005-15: descarta la sugerencia; devuelve false si no hubo conexión. */
  async dismiss(key: string): Promise<boolean> {
    return (await this.api.dismissSuggestion(key)) === 'ok';
  }
}
