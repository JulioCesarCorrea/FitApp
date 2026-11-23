// Inteligencia artificial: consentimientos y uso (SPEC-ai-001). Solo con conexión: la IA no se usa sin ella y ninguna operación
// básica depende de ella (P1). La app no habla con el proveedor: lo hace la API.

export interface AiFeatureState {
  feature: string;
  consented: boolean;
  /** La API tiene clave y modelo para esta función (si no, aparece desactivada). */
  available: boolean;
}

export interface AiUsage {
  monthCostUsd: number;
  monthlyCapUsd: number;
  tokensToday: number;
  dailyTokenCap: number;
  recent: { feature: string; model: string; tokens: number; costUsd: number; status: string; createdAt: string }[];
}

export interface AiApi {
  fetchAiConsents(): Promise<AiFeatureState[] | null>; // null = sin conexión o error
  setAiConsent(feature: string, consented: boolean): Promise<'ok' | 'retry'>;
  fetchAiUsage(): Promise<AiUsage | null>;
}

export interface FeatureInfo {
  feature: string;
  title: string;
  /** Qué sale del teléfono si se activa (AC-ai-001-13): siempre sin nombre ni datos de contacto. */
  explanation: string;
}

export const AI_FEATURES: FeatureInfo[] = [
  {
    feature: 'chat',
    title: 'Preguntas',
    explanation: 'Se envían el texto de tus preguntas y la conversación reciente. Solo si lo activas en cada pregunta, también resúmenes de tu progreso, sin tu nombre.',
  },
  {
    feature: 'analysis',
    title: 'Análisis y planes',
    explanation: 'Se envían resúmenes de tu entrenamiento y tu alimentación (promedios y tendencias, sin tu nombre) y tus restricciones y alergias como etiquetas.',
  },
  {
    feature: 'food_photo',
    title: 'Fotos de comida',
    explanation: 'Se envía la foto del plato (sin ubicación ni datos de la foto). No se guarda en ningún sitio. Las comidas son datos sensibles: actívalo solo si quieres.',
  },
];

export interface AiView {
  features: (AiFeatureState & FeatureInfo)[];
  usage: AiUsage | null;
  /** No hay conexión o la API no respondió: no se puede ver ni cambiar nada. */
  offline: boolean;
}

export class AiService {
  constructor(private readonly remote: AiApi) {}

  async load(): Promise<AiView> {
    const [states, usage] = await Promise.all([this.remote.fetchAiConsents(), this.remote.fetchAiUsage()]);
    if (!states) return { features: [], usage: null, offline: true };
    const features = AI_FEATURES.flatMap((info) => {
      const state = states.find((s) => s.feature === info.feature);
      return state ? [{ ...info, ...state }] : [];
    });
    return { features, usage, offline: false };
  }

  /** AC-ai-001-02 y 13: activa o retira el consentimiento de una función. */
  async setConsent(feature: string, consented: boolean): Promise<boolean> {
    return (await this.remote.setAiConsent(feature, consented)) === 'ok';
  }
}
