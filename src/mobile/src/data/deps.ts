import * as Crypto from 'expo-crypto';
import { HttpRemote } from './httpRemote';
import { PlanService } from './planService';
import { SessionService } from './sessionService';
import { SqliteStore } from './sqliteStore';
import type { LocalStore, RemoteApi } from './types';

export interface Deps {
  store: LocalStore;
  remote: RemoteApi;
  service: PlanService;
  sessions: SessionService;
}

/** Dependencias reales de la app: SQLite local, API por HTTP y UUID generado en el dispositivo. */
export async function createDeps(): Promise<Deps> {
  const store = new SqliteStore();
  const remote = new HttpRemote();
  const newId = () => Crypto.randomUUID();
  return {
    store,
    remote,
    service: new PlanService(store, remote, newId),
    sessions: new SessionService(store, remote, newId),
  };
}
