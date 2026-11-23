import * as Crypto from 'expo-crypto';
import { postWeight, setAuthorizer } from '../api';
import { openStore } from '../db';
import { syncPending, type LocalWeight } from '../sync';
import { HttpAuthRemote } from './authRemote';
import { AuthService } from './authService';
import { HttpRemote } from './httpRemote';
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
  return {
    store,
    remote,
    service,
    sessions: new SessionService(store, remote, newId),
    auth,
    profile: new ProfileService(store, remote, addWeight),
    restrictions: new RestrictionService(remote, newId, () => todayLocal()),
    suggestions: new SuggestionService(remote, service),
    nutrition: new NutritionService(store, remote, newId),
    weights,
    reminders: new ReminderService(store, new NotificationsScheduler(), () => weights.list(), () => auth.getState().status === 'signedIn'),
    products: new OpenFoodFactsClient(),
  };
}
