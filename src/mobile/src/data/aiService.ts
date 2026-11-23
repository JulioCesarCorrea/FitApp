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

// ---------- análisis y propuestas de plan (SPEC-ai-002) ----------

/** Cada afirmación del análisis distingue dato registrado, estimación e inferencia y cita su fuente (P4). */
export interface AnalysisClaim {
  text: string;
  kind: 'registrado' | 'estimacion' | 'inferencia';
  source: string;
  /** false = la app no pudo comprobarlo con tus datos y lo trata como inferencia. */
  verified: boolean;
}

export interface Analysis {
  scope: 'training' | 'nutrition';
  kind: 'proposal';
  sections: { title: string; claims: AnalysisClaim[] }[];
  disclaimer: string;
}

export interface ProposedChange {
  kind: 'replace_exercise' | 'add_entry';
  reason: string;
  day?: string | null;
  fromExerciseId?: string | null;
  toExerciseId?: string | null;
  toExerciseName?: string | null;
  meal?: string | null;
  foodId?: string | null;
  foodName?: string | null;
  grams?: number | null;
}

export interface Proposal {
  id: string;
  scope: 'training' | 'nutrition';
  kind: 'proposal';
  summary: string;
  changes: ProposedChange[];
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface ProposalResult {
  id: string;
  status: string;
  applied: number;
  skipped: number;
}

export type AiResult<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'offline' }
  | { kind: 'error'; code: string; message: string; retryAfterSeconds: number | null };

export interface AiAssistantApi {
  requestAnalysis(scope: string): Promise<AiResult<Analysis>>;
  requestPlan(scope: string): Promise<AiResult<Proposal>>;
  fetchProposals(): Promise<AiResult<Proposal[]>>;
  resolveProposal(id: string, action: 'accept' | 'reject'): Promise<AiResult<ProposalResult>>;
}

const ERROR_TEXT: Record<string, string> = {
  consent_required: 'Activa «Análisis y planes» en Inteligencia artificial para usar esto.',
  budget_exceeded: 'Has llegado a tu límite de uso de la IA. Vuelve a intentarlo más tarde.',
  provider_quota: 'El servicio de IA no admite más peticiones ahora mismo.',
  ai_disabled: 'La IA no está disponible ahora mismo.',
};

/** Texto para la persona de un error de la IA, con cuándo reintentar si se sabe. */
export function aiErrorText(error: { code: string; message: string; retryAfterSeconds: number | null }): string {
  const base = ERROR_TEXT[error.code] ?? error.message;
  return error.retryAfterSeconds ? `${base} Reintenta en ${error.retryAfterSeconds} s.` : base;
}

/** Análisis y propuestas con IA: solo con conexión; nada se aplica sin que la persona acepte (P4). */
export class AiAssistantService {
  constructor(private readonly remote: AiAssistantApi) {}

  analyze(scope: 'training' | 'nutrition') {
    return this.remote.requestAnalysis(scope);
  }

  propose(scope: 'training' | 'nutrition') {
    return this.remote.requestPlan(scope);
  }

  proposals() {
    return this.remote.fetchProposals();
  }

  accept(id: string) {
    return this.remote.resolveProposal(id, 'accept');
  }

  reject(id: string) {
    return this.remote.resolveProposal(id, 'reject');
  }
}
