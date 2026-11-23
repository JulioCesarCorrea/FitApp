import { beforeEach, describe, expect, it } from 'vitest';
import { ContextService, type ContextApi, type RawContextInput } from './contextService';
import { MemoryStore } from './memoryStore';
import type { PutLogResult, ServerContextItem } from './types';

const TODAY = '2026-11-23';

interface Fake extends ContextApi {
  online: boolean;
  calls: string[];
  server: Map<string, ServerContextItem>;
  putResult: PutLogResult | null;
}

function fakeRemote(): Fake {
  const r: Fake = {
    online: true, calls: [], server: new Map(), putResult: null,
    fetchContextItems: async () => (r.online ? [...r.server.values()].map((i) => ({ ...i })) : null),
    putContextItem: async (item) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`put:${item.id}`);
      if (r.putResult) return r.putResult;
      r.server.set(item.id, { ...item });
      return { kind: 'ok' };
    },
    deleteContextItem: async (id) => {
      if (!r.online) return 'retry';
      r.calls.push(`delete:${id}`);
      r.server.delete(id);
      return 'ok';
    },
  };
  return r;
}

const input = (over: Partial<RawContextInput> = {}): RawContextInput => ({
  type: 'suplemento', name: 'Creatina', brand: 'Marca X', dose: '5 g', frequency: 'diario', startedOn: '2026-10-01', endedOn: '', note: '',
  shareWithAi: true, ...over,
});

let store: MemoryStore;
let remote: Fake;
let service: ContextService;

beforeEach(() => {
  let n = 0;
  store = new MemoryStore();
  remote = fakeRemote();
  service = new ContextService(store, remote, () => `id-${++n}`, () => TODAY);
});

const saved = async (over: Partial<RawContextInput> = {}) => {
  const result = await service.save(input(over));
  if (!result.ok) throw new Error(result.issues.map((i) => i.message).join(' '));
  return result.item;
};

describe('ContextService (SPEC-profile-002)', () => {
  it('AC-profile-002-12 y 13: guarda con un id del dispositivo y lo envía a la API con el interruptor', async () => {
    const item = await saved();

    expect(item).toMatchObject({ id: 'id-1', name: 'Creatina', dose: '5 g', status: 'synced', shareWithAi: true });
    expect(remote.server.get('id-1')).toMatchObject({ brand: 'Marca X', frequency: 'diario', shareWithAi: true });
  });

  it('AC-profile-002-13: sin conexión queda pendiente y se envía al volver, sin duplicados', async () => {
    remote.online = false;
    await saved();
    await saved({ name: 'Magnesio' });
    expect(await store.countPendingChanges()).toBe(2);

    remote.online = true;
    await service.syncPending();
    await service.syncPending();

    expect(remote.calls.filter((c) => c.startsWith('put:'))).toHaveLength(2);
    expect(await store.countPendingChanges()).toBe(0);
  });

  it('AC-profile-002-03: la medicación se guarda siempre sin compartir', async () => {
    const item = await saved({ type: 'medicacion', name: 'Ibuprofeno', shareWithAi: true });

    expect(item.shareWithAi).toBe(false);
    expect(remote.server.get(item.id)?.shareWithAi).toBe(false);
  });

  it('AC-profile-002-02 y 04: valida como la API', async () => {
    const bad = async (over: Partial<RawContextInput>) => {
      const result = await service.save(input(over));
      return result.ok ? [] : result.issues.map((i) => i.field);
    };

    expect(await bad({ name: '' })).toContain('name');
    expect(await bad({ type: 'otro' })).toContain('type');
    expect(await bad({ frequency: 'cada rato' })).toContain('frequency');
    expect(await bad({ startedOn: '2026-10-10', endedOn: '2026-10-01' })).toContain('endedOn');
    expect(await bad({ type: 'nota', dose: '', frequency: '', note: 'Escríbeme a julio@correo.com' })).toContain('note');
    expect(await bad({ type: 'nota', dose: '5 g', frequency: '', note: 'Duermo poco' })).toContain('note');
    expect(await bad({ type: 'nota', dose: '', frequency: '', note: 'x'.repeat(281) })).toContain('note');
    expect(remote.calls).toEqual([]);
  });

  it('AC-profile-002-08: la entrada 51 activa se rechaza, pero dar de baja libera espacio', async () => {
    for (let i = 0; i < 50; i += 1) await saved({ name: `S${String(i).padStart(2, '0')}` });

    const over = await service.save(input({ name: 'Extra' }));
    await service.end('id-1');
    const after = await service.save(input({ name: 'Extra' }));

    expect(over.ok).toBe(false);
    expect(after.ok).toBe(true);
  });

  it('AC-profile-002-06: dar de baja conserva la entrada y borrar la quita también de la API', async () => {
    const item = await saved();

    await service.end(item.id);
    expect((await service.list()).map((i) => [i.name, i.endedOn])).toEqual([['Creatina', TODAY]]);
    expect(remote.server.get(item.id)?.endedOn).toBe(TODAY);

    await service.remove(item.id);
    expect(await service.list()).toEqual([]);
    expect(remote.server.has(item.id)).toBe(false);
  });

  it('AC-profile-002-12: ordena por tipo y nombre y refresh trae lo de la API sin pisar lo pendiente', async () => {
    remote.server.set('srv-1', {
      id: 'srv-1', type: 'habito', name: 'Cafeína', brand: null, dose: '2 tazas', frequency: 'diario', startedOn: null, endedOn: null, note: null, shareWithAi: false,
    });
    await saved({ name: 'Zinc' });
    remote.online = false;
    await saved({ name: 'Magnesio' });

    remote.online = true;
    await service.refresh();

    expect((await service.list()).map((i) => i.name)).toEqual(['Magnesio', 'Zinc', 'Cafeína']);
  });

  it('AC-profile-002-13: una entrada rechazada por la API queda marcada y se puede descartar', async () => {
    remote.putResult = { kind: 'rejected', reason: 'Tienes el máximo.' };

    const item = await saved();
    expect((await store.getContextItem(item.id))?.status).toBe('rejected');
    await service.discard(item.id);

    expect(await service.list()).toEqual([]);
  });
});
