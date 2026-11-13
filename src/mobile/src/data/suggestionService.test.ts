import { describe, expect, it } from 'vitest';
import { SuggestionService } from './suggestionService';
import type { AcceptSuggestionResult, Suggestion, SuggestionsApi } from './types';

const SUGGESTION: Suggestion = {
  key: 'ejercicio-estancado:press:martes:2026-10-29',
  kind: 'ejercicio-estancado',
  exerciseId: 'press',
  day: 'martes',
  message: 'Llevas 3 sesiones sin mejorar.',
  alternatives: [{ exerciseId: 'otro', name: 'Otro' }],
};

function fakeApi(over: Partial<SuggestionsApi> = {}) {
  const calls: string[] = [];
  const api: SuggestionsApi = {
    fetchSuggestions: async () => [SUGGESTION],
    acceptSuggestion: async (key, replacement) => {
      calls.push(`accept:${key}:${replacement}`);
      return { kind: 'ok' };
    },
    dismissSuggestion: async (key) => {
      calls.push(`dismiss:${key}`);
      return 'ok';
    },
    ...over,
  };
  return { api, calls };
}

const plan = () => {
  const state = { hydrated: 0 };
  return { state, plan: { hydrate: async () => { state.hydrated++; } } };
};

describe('sugerencias (SPEC-training-005)', () => {
  it('AC-training-005-15 la lista llega tal cual la calcula la API', async () => {
    const { api } = fakeApi();

    const result = await new SuggestionService(api, plan().plan).list();

    expect(result).toEqual({ status: 'ok', items: [SUGGESTION] });
  });

  it('AC-training-005-16 sin conexión (la API no responde) la lista es «offline», no un error', async () => {
    const { api } = fakeApi({ fetchSuggestions: async () => null });

    expect(await new SuggestionService(api, plan().plan).list()).toEqual({ status: 'offline' });
  });

  it('AC-training-005-15 aceptar envía la alternativa y trae la rutina actualizada', async () => {
    const { api, calls } = fakeApi();
    const { plan: p, state } = plan();

    const result = await new SuggestionService(api, p).accept(SUGGESTION, 'otro');

    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([`accept:${SUGGESTION.key}:otro`]);
    expect(state.hydrated).toBe(1);
  });

  it.each<[AcceptSuggestionResult, string]>([
    [{ kind: 'rejected', reason: 'Ese ejercicio no es una de las alternativas de la sugerencia.' }, 'no es una de las alternativas'],
    [{ kind: 'retry' }, 'Sin conexión'],
  ])('AC-training-005-15 si no se puede aplicar (%j) devuelve el motivo y no toca la rutina', async (outcome, text) => {
    const { api } = fakeApi({ acceptSuggestion: async () => outcome });
    const { plan: p, state } = plan();

    const result = await new SuggestionService(api, p).accept(SUGGESTION, 'otro');

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).toContain(text);
    expect(state.hydrated).toBe(0);
  });

  it('AC-training-005-15 descartar avisa a la API y dice si hubo conexión', async () => {
    const { api, calls } = fakeApi();
    const offline = fakeApi({ dismissSuggestion: async () => 'retry' });

    expect(await new SuggestionService(api, plan().plan).dismiss(SUGGESTION.key)).toBe(true);
    expect(calls).toEqual([`dismiss:${SUGGESTION.key}`]);
    expect(await new SuggestionService(offline.api, plan().plan).dismiss(SUGGESTION.key)).toBe(false);
  });
});
