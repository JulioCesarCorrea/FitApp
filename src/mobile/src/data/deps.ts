import * as Crypto from 'expo-crypto';
import { HttpRemote } from './httpRemote';
import { PlanService } from './planService';
import { SqliteStore } from './sqliteStore';
import type { LocalStore, RemoteApi } from './types';

export interface Deps {
  store: LocalStore;
  remote: RemoteApi;
  service: PlanService;
}

/** Dependencias reales de la app: SQLite local, API por HTTP y UUID generado en el dispositivo. */
export async function createDeps(): Promise<Deps> {
  const store = new SqliteStore();
  const remote = new HttpRemote();
  return { store, remote, service: new PlanService(store, remote, () => Crypto.randomUUID()) };
}
