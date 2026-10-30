import * as Crypto from 'expo-crypto';
import { setAuthorizer } from '../api';
import { HttpAuthRemote } from './authRemote';
import { AuthService } from './authService';
import { HttpRemote } from './httpRemote';
import { PlanService } from './planService';
import { SecureTokenStore } from './secureTokenStore';
import { SessionService } from './sessionService';
import { SqliteStore } from './sqliteStore';
import type { LocalStore, RemoteApi } from './types';

export interface Deps {
  store: LocalStore;
  remote: RemoteApi;
  service: PlanService;
  sessions: SessionService;
  auth: AuthService;
}

/** Dependencias reales de la app: SQLite local, API por HTTP y UUID generado en el dispositivo. */
export async function createDeps(): Promise<Deps> {
  const store = new SqliteStore();
  const auth = new AuthService(new SecureTokenStore(), new HttpAuthRemote(), store);
  setAuthorizer(auth);
  const remote = new HttpRemote(auth);
  const newId = () => Crypto.randomUUID();
  return {
    store,
    remote,
    service: new PlanService(store, remote, newId),
    sessions: new SessionService(store, remote, newId),
    auth,
  };
}
