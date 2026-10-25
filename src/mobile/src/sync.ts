// Lógica de sincronización de SPEC-mobile-001. Sin dependencias de React Native:
// el almacén y el cliente HTTP se inyectan para poder probarla en Node.

export type WeightStatus = 'pending' | 'synced' | 'rejected';

export interface LocalWeight {
  id: string;
  weightKg: number;
  measuredAt: string; // ISO 8601 UTC
  createdAt: string;
  status: WeightStatus;
  error: string | null;
}

export interface WeightStore {
  /** Pendientes por fecha de creación ascendente. */
  listPending(): Promise<LocalWeight[]>;
  markSynced(id: string): Promise<void>;
  markRejected(id: string, reason: string): Promise<void>;
}

export type PostResult =
  | { kind: 'ok' } // 201 o 200
  | { kind: 'rejected'; reason: string } // 400 o 409: no se reintenta
  | { kind: 'retry' }; // red, 5xx o 401: se reintenta luego

export type PostWeight = (weight: LocalWeight) => Promise<PostResult>;

export interface SyncSummary {
  synced: number;
  rejected: number;
  stoppedByError: boolean;
}

export async function syncPending(store: WeightStore, post: PostWeight): Promise<SyncSummary> {
  const summary: SyncSummary = { synced: 0, rejected: 0, stoppedByError: false };

  for (const weight of await store.listPending()) {
    const result = await post(weight);

    if (result.kind === 'ok') {
      await store.markSynced(weight.id);
      summary.synced++;
    } else if (result.kind === 'rejected') {
      await store.markRejected(weight.id, result.reason);
      summary.rejected++;
    } else {
      summary.stoppedByError = true;
      break; // conserva el orden y no insiste con una red caída
    }
  }

  return summary;
}
