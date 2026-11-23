import * as Crypto from 'expo-crypto';
import { postWeight, setAuthorizer } from '../api';
import { openStore } from '../db';
import { syncPending, type LocalWeight } from '../sync';
import { HttpAuthRemote } from './authRemote';
import { AiAssistantService, AiService } from './aiService';
import { AuthService } from './authService';
import { ChatService } from './chatService';
import { ContextService } from './contextService';
import { FoodPhotoService } from './foodPhotoService';
import { HttpRemote } from './httpRemote';
import { ImagePickerCapture } from './imagePickerCapture';
import { NutritionService } from './nutritionService';
import { NotificationsScheduler } from './notificationsScheduler';
import { OpenFoodFactsClient } from './openFoodFacts';
import { PlanService } from './planService';
import { ProfileService } from './profileService';
import { ReminderService } from './reminderService';
import { RestrictionService } from './restrictionService';
import { SecureTokenStore } from './secureTokenStore';
import { SessionService, todayLocal } from './sessionService';
import { SqliteStore } from './sqliteStore';
import { SuggestionService } from './suggestionService';
import type { LocalStore, ProductLookup, RemoteApi } from './types';

/** Pesos guardados en el teléfono (SPEC-progress-002): los registrados con el spike y los del asistente, también los pendientes. */
export interface WeightSource {
  list(): Promise<LocalWeight[]>;
}

export interface Deps {
  store: LocalStore;
  remote: RemoteApi;
  service: PlanService;
  sessions: SessionService;
  auth: AuthService;
  profile: ProfileService;
  restrictions: RestrictionService;
  suggestions: SuggestionService;
  nutrition: NutritionService;
  weights: WeightSource;
  /** Consentimientos y uso de la IA (SPEC-ai-001). */
  ai: AiService;
  /** Análisis y propuestas con IA (SPEC-ai-002). */
  assistant: AiAssistantService;
  /** Preguntas a la IA, guardadas solo en el teléfono (SPEC-ai-004). */
  chat: ChatService;
  /** Foto de comida con IA (SPEC-ai-003). */
  photo: FoodPhotoService;
  /** Contexto personal: suplementos, hábitos, medicación y notas (SPEC-profile-002). */
  context: ContextService;
  /** Recordatorios locales (SPEC-notify-001). */
  reminders: ReminderService;
  /** Consulta de productos por código de barras (Open Food Facts). */
  products: ProductLookup;
}

/** Dependencias reales de la app: SQLite local, API por HTTP y UUID generado en el dispositivo. */
export async function createDeps(): Promise<Deps> {
  const store = new SqliteStore();
  const auth = new AuthService(new SecureTokenStore(), new HttpAuthRemote(), store);
  setAuthorizer(auth);
  const remote = new HttpRemote(auth);
  const newId = () => Crypto.randomUUID();
  // El peso del asistente entra en la cola de pesos del spike (id generado aquí) y se intenta enviar al momento.
  const addWeight = async (weightKg: number) => {
    const weights = await openStore();
    await weights.add(weightKg);
    await syncPending(weights, postWeight).catch(() => {});
  };
  const weights: WeightSource = { list: async () => (await openStore()).listAll() };
  const service = new PlanService(store, remote, newId);
  const nutrition = new NutritionService(store, remote, newId);
  return {
    store,
    remote,
    service,
    sessions: new SessionService(store, remote, newId),
    auth,
    profile: new ProfileService(store, remote, addWeight),
    restrictions: new RestrictionService(remote, newId, () => todayLocal()),
    suggestions: new SuggestionService(remote, service),
    nutrition,
    weights,
    ai: new AiService(remote),
    assistant: new AiAssistantService(remote),
    chat: new ChatService(store, remote, newId),
    photo: new FoodPhotoService(new ImagePickerCapture(), remote, nutrition),
    context: new ContextService(store, remote, newId),
    reminders: new ReminderService(store, new NotificationsScheduler(), () => weights.list(), () => auth.getState().status === 'signedIn'),
    products: new OpenFoodFactsClient(),
  };
}
