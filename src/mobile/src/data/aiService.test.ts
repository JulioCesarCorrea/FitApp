import { describe, expect, it } from 'vitest';
import { AiService, type AiApi, type AiFeatureState, type AiUsage } from './aiService';

const USAGE: AiUsage = { monthCostUsd: 0.5, monthlyCapUsd: 5, tokensToday: 1200, dailyTokenCap: 80000, recent: [] };

function fake(online = true) {
  const state = {
    online,
    features: [
      { feature: 'chat', consented: false, available: true },
      { feature: 'analysis', consented: true, available: true },
      { feature: 'food_photo', consented: false, available: false },
    ] as AiFeatureState[],
  };
  const api: AiApi = {
    fetchAiConsents: async () => (state.online ? state.features.map((f) => ({ ...f })) : null),
    setAiConsent: async (feature, consented) => {
      if (!state.online) return 'retry';
      state.features = state.features.map((f) => (f.feature === feature ? { ...f, consented } : f));
      return 'ok';
    },
    fetchAiUsage: async () => (state.online ? USAGE : null),
  };
  return { state, service: new AiService(api) };
}

describe('Inteligencia artificial (SPEC-ai-001)', () => {
  it('AC-ai-001-13 muestra cada función con su explicación, si está activada y si está disponible, y el uso', async () => {
    const { service } = fake();

    const view = await service.load();

    expect(view.offline).toBe(false);
    expect(view.features.map((f) => [f.feature, f.title, f.consented, f.available])).toEqual([
      ['chat', 'Preguntas', false, true], ['analysis', 'Análisis y planes', true, true], ['food_photo', 'Fotos de comida', false, false],
    ]);
    expect(view.features.every((f) => f.explanation.length > 20)).toBe(true);
    expect(view.usage).toEqual(USAGE);
  });

  it('AC-ai-001-02 y 13 activar y retirar el consentimiento llega a la API', async () => {
    const { service, state } = fake();

    expect(await service.setConsent('chat', true)).toBe(true);
    expect(state.features.find((f) => f.feature === 'chat')?.consented).toBe(true);
    expect(await service.setConsent('chat', false)).toBe(true);
    expect(state.features.find((f) => f.feature === 'chat')?.consented).toBe(false);
  });

  it('AC-ai-001-13 sin conexión no muestra nada que cambiar y no se puede modificar', async () => {
    const { service } = fake(false);

    expect(await service.load()).toEqual({ features: [], usage: null, offline: true });
    expect(await service.setConsent('chat', true)).toBe(false);
  });
});
