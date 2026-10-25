import { describe, expect, it } from 'vitest';
import { syncPending, type LocalWeight, type PostResult, type WeightStore } from './sync';

function weight(id: string, createdAt: string): LocalWeight {
  return { id, weightKg: 80, measuredAt: createdAt, createdAt, status: 'pending', error: null };
}

function fakeStore(initial: LocalWeight[]): WeightStore & { rows: LocalWeight[] } {
  const rows = [...initial];
  return {
    rows,
    listPending: async () =>
      rows.filter((r) => r.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    markSynced: async (id) => {
      rows.find((r) => r.id === id)!.status = 'synced';
    },
    markRejected: async (id, reason) => {
      const row = rows.find((r) => r.id === id)!;
      row.status = 'rejected';
      row.error = reason;
    },
  };
}

describe('syncPending (SPEC-mobile-001)', () => {
  it('AC-mobile-001-02: envía en orden de creación y marca sincronizados los aceptados', async () => {
    const store = fakeStore([weight('b', '2026-01-02'), weight('a', '2026-01-01')]);
    const sent: string[] = [];

    const summary = await syncPending(store, async (w) => {
      sent.push(w.id);
      return { kind: 'ok' };
    });

    expect(sent).toEqual(['a', 'b']);
    expect(summary).toEqual({ synced: 2, rejected: 0, stoppedByError: false });
    expect(store.rows.every((r) => r.status === 'synced')).toBe(true);
  });

  it('AC-mobile-001-03: ante un error recuperable se detiene y no pierde nada', async () => {
    const store = fakeStore([weight('a', '2026-01-01'), weight('b', '2026-01-02'), weight('c', '2026-01-03')]);

    const summary = await syncPending(store, async (w) =>
      w.id === 'b' ? { kind: 'retry' } : { kind: 'ok' },
    );

    expect(summary).toEqual({ synced: 1, rejected: 0, stoppedByError: true });
    expect(store.rows.map((r) => r.status)).toEqual(['synced', 'pending', 'pending']);
  });

  it('AC-mobile-001-03: al reintentar reenvía el mismo id', async () => {
    const store = fakeStore([weight('a', '2026-01-01')]);
    const attempts: string[] = [];
    let online = false;
    const post = async (w: LocalWeight): Promise<PostResult> => {
      attempts.push(w.id);
      return online ? { kind: 'ok' } : { kind: 'retry' };
    };

    await syncPending(store, post);
    online = true;
    await syncPending(store, post);

    expect(attempts).toEqual(['a', 'a']);
    expect(store.rows[0].status).toBe('synced');
  });

  it('AC-mobile-001-04: 400/409 marca rechazado con motivo y continúa con los demás', async () => {
    const store = fakeStore([weight('a', '2026-01-01'), weight('b', '2026-01-02')]);

    const summary = await syncPending(store, async (w) =>
      w.id === 'a' ? { kind: 'rejected', reason: 'peso fuera de rango' } : { kind: 'ok' },
    );

    expect(summary).toEqual({ synced: 1, rejected: 1, stoppedByError: false });
    expect(store.rows[0]).toMatchObject({ status: 'rejected', error: 'peso fuera de rango' });
    expect(store.rows[1].status).toBe('synced');
  });

  it('no hace nada si no hay pendientes', async () => {
    const summary = await syncPending(fakeStore([]), async () => ({ kind: 'ok' }));
    expect(summary).toEqual({ synced: 0, rejected: 0, stoppedByError: false });
  });
});
