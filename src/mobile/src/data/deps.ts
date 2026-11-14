import * as Crypto from 'expo-crypto';
import { postWeight, setAuthorizer } from '../api';
import { openStore } from '../db';
import { syncPending } from '../sync';
import { HttpAuthRemote } from './authRemote';
import { AuthService } from './authService';
import { HttpRemote } from './httpRemote';
import { NutritionService } from './nutritionService';
import { OpenFoodFactsClient } from './openFoodFacts';
import { PlanService } from './planService';
import { ProfileService } from './profileService';
import { RestrictionService } from './restrictionService';
import { SecureTokenStore } from './secureTokenStore';
import { SessionService, todayLocal } from './sessionService';
import { SqliteStore } from './sqliteStore';
import { SuggestionService } from './suggestionService';
import type { LocalStore, ProductLookup, RemoteApi } from './types';

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
    products: new OpenFoodFactsClient(),
  };
}
