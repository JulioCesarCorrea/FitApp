import { beforeEach, describe, expect, it } from 'vitest';
import { RestrictionService, isDueForReview } from './restrictionService';
import type { PutLogResult, RemoteApi, RestrictionItem } from './types';

const TODAY = '2026-10-30';

interface Fake {
  online: boolean;
  server: Map<string, RestrictionItem>;
  putResult: PutLogResult | null;
  calls: string[];
}

function fakeRemote(): Fake & RemoteApi {
  const r = {
    online: true,
    server: new Map<string, RestrictionItem>(),
    putResult: null as PutLogResult | null,
    calls: [] as string[],
    fetchRestrictions: async () => (r.online ? [...r.server.values()] : null),
    putRestriction: async (item: RestrictionItem): Promise<PutLogResult> => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`put:${item.id}`);
      if (r.putResult) return r.putResult;
      r.server.set(item.id, item);
      return { kind: 'ok' };
    },
    deleteRestriction: async (id: string) => {
      if (!r.online) return 'retry' as const;
      r.calls.push(`delete:${id}`);
      r.server.delete(id);
      return 'ok' as const;
    },
  };
  return r as unknown as Fake & RemoteApi;
}

let remote: Fake & RemoteApi;
let service: RestrictionService;

beforeEach(() => {
  remote = fakeRemote();
  let n = 0;
  service = new RestrictionService(remote, () => `r-${++n}`, () => TODAY);
});

const input = { zone: 'pecho', avoidedMovements: ['empuje_horizontal'], level: 'aviso' as const, reviewOn: '' };

describe('gestionar restricciones (AC-profile-001-15 y 18)', () => {
  it('AC-profile-001-18 lista las restricciones del servidor', async () => {
    remote.server.set('x', { id: 'x', zone: 'pecho', avoidedMovements: [], level: 'bloqueo', reviewOn: null });

    expect(await service.list()).toEqual([{ id: 'x', zone: 'pecho', avoidedMovements: [], level: 'bloqueo', reviewOn: null }]);
  });

  it('AC-profile-001-18 sin conexión la lista no está disponible', async () => {
    remote.online = false;

    expect(await service.list()).toBeNull();
  });

  it('AC-profile-001-15 añade una restricción con un id nuevo generado en el dispositivo', async () => {
    const result = await service.save(input);

    expect(result).toEqual({
      kind: 'ok',
      item: { id: 'r-1', zone: 'pecho', avoidedMovements: ['empuje_horizontal'], level: 'aviso', reviewOn: null },
    });
    expect(remote.calls).toEqual(['put:r-1']);
  });

  it('AC-profile-001-18 editar reutiliza el id y reemplaza la anterior', async () => {
    await service.save(input);

    const result = await service.save({ ...input, id: 'r-1', level: 'bloqueo', reviewOn: '2027-01-15' });

    expect(result.kind).toBe('ok');
    expect(remote.server.size).toBe(1);
    expect(remote.server.get('r-1')).toMatchObject({ level: 'bloqueo', reviewOn: '2027-01-15' });
  });

  it('AC-profile-001-15 la fecha de revisión es opcional y se valida', async () => {
    for (const reviewOn of ['15/01/2027', '2027-02-30', '2026-10-27']) {
      const result = await service.save({ ...input, reviewOn });
      expect(result.kind).toBe('invalid');
    }
    expect((await service.save({ ...input, reviewOn: '2026-10-30' })).kind).toBe('ok'); // hoy vale
    expect(remote.calls).toEqual(['put:r-1']);
  });

  it('AC-profile-001-15 exige la zona y el nivel', async () => {
    const noZone = await service.save({ ...input, zone: '' });
    const noLevel = await service.save({ ...input, level: null });

    expect(noZone.kind).toBe('invalid');
    expect(noLevel.kind).toBe('invalid');
    expect(remote.calls).toEqual([]);
  });

  it('AC-profile-001-15 sin conexión indica que hace falta y no guarda nada', async () => {
    remote.online = false;

    const result = await service.save(input);

    expect(result).toEqual({ kind: 'network', message: 'Necesitas conexión para cambiar tus restricciones.' });
  });

  it('AC-profile-001-15 si la API rechaza la restricción muestra el motivo', async () => {
    remote.putResult = { kind: 'rejected', reason: "La zona 'x' no existe en el catálogo." };

    const result = await service.save(input);

    expect(result).toEqual({ kind: 'rejected', message: "La zona 'x' no existe en el catálogo." });
  });

  it('AC-profile-001-18 borra una restricción y sin conexión lo indica', async () => {
    await service.save(input);
    expect(await service.remove('r-1')).toBe('ok');
    expect(remote.server.size).toBe(0);

    remote.online = false;
    expect(await service.remove('r-1')).toEqual({ kind: 'network', message: 'Necesitas conexión para cambiar tus restricciones.' });
  });
});

describe('pendiente de revisar (AC-profile-001-18)', () => {
  const item = (reviewOn: string | null): RestrictionItem => ({ id: 'a', zone: 'pecho', avoidedMovements: [], level: 'aviso', reviewOn });

  it('AC-profile-001-18 llega la fecha o ya pasó: pendiente de revisar; antes o sin fecha: no', () => {
    expect(isDueForReview(item('2026-10-30'), TODAY)).toBe(true);
    expect(isDueForReview(item('2026-09-01'), TODAY)).toBe(true);
    expect(isDueForReview(item('2026-10-31'), TODAY)).toBe(false);
    expect(isDueForReview(item(null), TODAY)).toBe(false);
  });

  it('AC-profile-001-18 el nivel no cambia solo', async () => {
    const result = await new RestrictionService(remote, () => 'z', () => TODAY).save({ ...input, level: 'bloqueo', reviewOn: '2026-10-30' });

    expect(result.kind === 'ok' && result.item.level).toBe('bloqueo');
    expect(isDueForReview(item('2026-10-30'), TODAY)).toBe(true);
  });
});
