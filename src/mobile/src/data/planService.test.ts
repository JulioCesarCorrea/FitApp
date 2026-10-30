import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memoryStore';
import { PlanService, validateEquipment } from './planService';
import type {
  CatalogSection, DayKey, EquipmentProfile, LocalPlanEntry, PutDayResult, PutEquipmentResult, RemoteApi,
} from './types';

const catalog: CatalogSection[] = [
  {
    name: 'Pecho',
    exercises: [{
      id: 'press-plano-con-barra', name: 'Press plano con barra', primaryZone: 'pecho',
      secondaryZones: [], movements: [], equipment: 'Barra', bar: 'Recta', images: [],
    }],
  },
];

const profile: EquipmentProfile = {
  dumbbellsKg: [20, 22.5], barsKg: { recta: 20 }, discsKg: [2.5, 5], machineStepKg: 5, machineBaseKg: 0,
};

interface FakeRemote extends RemoteApi {
  sent: { day: DayKey; entries: LocalPlanEntry[]; confirm: boolean }[];
  dayResult: (day: DayKey, confirm: boolean) => PutDayResult;
  equipmentResult: PutEquipmentResult;
  online: boolean;
}

function fakeRemote(): FakeRemote {
  const r: FakeRemote = {
    sent: [],
    online: true,
    equipmentResult: { kind: 'ok' },
    dayResult: () => ({ kind: 'ok', entries: [] }),
    putLog: async () => ({ kind: 'retry' }),
    deleteLog: async () => 'retry',
    fetchHistory: async () => null,
    fetchTrainingSettings: async () => null,
    putTrainingSettings: async () => ({ kind: 'retry' }),
    fetchCatalog: async () => (r.online ? catalog : null),
    fetchPlan: async () => (r.online ? [] : null),
    fetchEquipment: async () => (r.online ? 'none' : null),
    putDay: async (day, entries, confirm) => {
      if (!r.online) return { kind: 'retry' };
      r.sent.push({ day, entries, confirm });
      return r.dayResult(day, confirm);
    },
    putEquipment: async () => (r.online ? r.equipmentResult : { kind: 'retry' }),
    imageUrl: (p) => p,
  };
  return r;
}

function setup() {
  let n = 0;
  const store = new MemoryStore();
  const remote = fakeRemote();
  const service = new PlanService(store, remote, () => `id-${++n}`);
  return { store, remote, service };
}

describe('PlanService (SPEC-mobile-002)', () => {
  it('AC-mobile-002-03: asigna el ejercicio a varios días, con id propio por día', async () => {
    const { service, store } = setup();

    await service.assign('press-plano-con-barra', ['martes', 'jueves']);

    const days = await store.getDays();
    expect(days.map((d) => d.day)).toEqual(['martes', 'jueves']);
    expect(days[0].entries[0].id).not.toBe(days[1].entries[0].id);
    expect(days.every((d) => d.status === 'synced')).toBe(true);
  });

  it('AC-mobile-002-03: añade al final del día respetando el orden', async () => {
    const { service, store } = setup();

    await service.assign('a', ['martes']);
    await service.assign('b', ['martes']);

    const [martes] = await store.getDays();
    expect(martes.entries.map((e) => [e.exerciseId, e.order])).toEqual([['a', 0], ['b', 1]]);
  });

  it('AC-mobile-002-11: no añade un ejercicio a un día donde ya está (ni lo envía)', async () => {
    const { service, store, remote } = setup();
    await service.assign('a', ['martes']);
    const enviados = remote.sent.length;

    const outcomes = await service.assign('a', ['martes']);

    expect(outcomes).toEqual([]);
    expect((await store.getDays())[0].entries).toHaveLength(1);
    expect(remote.sent.length).toBe(enviados);
  });

  it('AC-mobile-002-11: al pedir varios días omite solo los que ya lo tienen', async () => {
    const { service, store } = setup();
    await service.assign('a', ['martes']);

    const outcomes = await service.assign('a', ['martes', 'jueves']);

    expect(outcomes.map((o) => o.day)).toEqual(['jueves']);
    const days = await store.getDays();
    expect(days.map((d) => [d.day, d.entries.length])).toEqual([['martes', 1], ['jueves', 1]]);
  });

  it('AC-mobile-002-11: informa en qué días ya está un ejercicio', async () => {
    const { service } = setup();
    await service.assign('a', ['jueves', 'martes']);
    await service.assign('b', ['lunes']);

    expect(await service.daysWithExercise('a')).toEqual(['martes', 'jueves']);
    expect(await service.daysWithExercise('b')).toEqual(['lunes']);
    expect(await service.daysWithExercise('zzz')).toEqual([]);
  });

  it('AC-mobile-002-04: rechaza un escalón de máquina menor o igual a cero', async () => {
    const { service } = setup();

    await expect(service.assign('prensa', ['martes'], 0)).rejects.toThrow();
  });

  it('AC-mobile-002-04: valida el perfil de equipamiento (mayor que cero)', () => {
    const issues = validateEquipment({ ...profile, dumbbellsKg: [20, -1], machineStepKg: 0 });

    expect(issues.map((i) => i.field)).toEqual(['dumbbellsKg', 'machineStepKg']);
    expect(validateEquipment(profile)).toEqual([]);
  });

  it('AC-mobile-002-04: guarda el perfil y lo marca sincronizado; no envía uno inválido', async () => {
    const { service, store } = setup();

    const bad = await service.saveEquipment({ ...profile, machineStepKg: 0 });
    expect(bad.issues).toHaveLength(1);
    expect((await store.getEquipment()).profile).toBeNull();

    const ok = await service.saveEquipment(profile);
    expect(ok.issues).toEqual([]);
    expect((await store.getEquipment()).status).toBe('synced');
  });

  it('AC-mobile-002-05: nivel aviso deja el día pendiente de confirmar y al confirmar se reenvía', async () => {
    const { service, remote, store } = setup();
    remote.dayResult = (_d, confirm) =>
      confirm ? { kind: 'ok', entries: [] } : { kind: 'warnings', hits: [{ exerciseId: 'a', exerciseName: 'Elevación', zones: ['hombros'] }] };

    const [first] = await service.assign('a', ['miercoles']);
    expect(first.result?.kind).toBe('warnings');
    expect((await store.getDays())[0].status).toBe('needs_confirmation');
    expect((await store.getDays())[0].message).toContain('Elevación');

    await service.confirmDay('miercoles');
    expect((await store.getDays())[0].status).toBe('synced');
    expect(remote.sent.at(-1)?.confirm).toBe(true);
  });

  it('AC-mobile-002-05: nivel bloqueo deja el día rechazado con el motivo', async () => {
    const { service, remote, store } = setup();
    remote.dayResult = () => ({ kind: 'blocked', hits: [{ exerciseId: 'c', exerciseName: 'Crunch', zones: ['abdomen'] }] });

    await service.assign('c', ['martes']);

    const [martes] = await store.getDays();
    expect(martes.status).toBe('rejected');
    expect(martes.message).toContain('Crunch');
  });

  it('AC-mobile-002-06: quita y reordena los ejercicios del día', async () => {
    const { service, store } = setup();
    await service.assign('a', ['martes']);
    await service.assign('b', ['martes']);
    await service.assign('c', ['martes']);

    let [martes] = await store.getDays();
    await service.move('martes', martes.entries[2].id, -1);
    [martes] = await store.getDays();
    expect(martes.entries.map((e) => e.exerciseId)).toEqual(['a', 'c', 'b']);

    await service.remove('martes', martes.entries[0].id);
    [martes] = await store.getDays();
    expect(martes.entries.map((e) => [e.exerciseId, e.order])).toEqual([['c', 0], ['b', 1]]);
  });

  it('AC-mobile-002-06: no mueve más allá de los extremos', async () => {
    const { service, store } = setup();
    await service.assign('a', ['martes']);
    await service.assign('b', ['martes']);
    const [martes] = await store.getDays();

    expect(await service.move('martes', martes.entries[0].id, -1)).toEqual([]);
    expect(await service.move('martes', martes.entries[1].id, 1)).toEqual([]);
  });

  it('AC-mobile-002-07: sin conexión guarda en local, queda pendiente y se envía al volver con los mismos ids', async () => {
    const { service, remote, store } = setup();
    remote.online = false;

    await service.assign('a', ['martes']);
    const idOffline = (await store.getDays())[0].entries[0].id;
    expect((await store.getDays())[0].status).toBe('pending');

    remote.online = true;
    await service.syncPending();

    const [martes] = await store.getDays();
    expect(martes.status).toBe('synced');
    expect(remote.sent.at(-1)?.entries[0].id).toBe(idOffline);
  });

  it('AC-mobile-002-07: sin conexión se detiene en el primer error y conserva el orden semanal', async () => {
    const { service, remote } = setup();
    remote.online = false;
    await service.assign('a', ['jueves']);
    await service.assign('a', ['martes']);

    remote.online = true;
    await service.syncPending();

    expect(remote.sent.map((s) => s.day)).toEqual(['martes', 'jueves']);
  });

  it('AC-mobile-002-07: un 400 deja el día rechazado y no se reintenta', async () => {
    const { service, remote, store } = setup();
    remote.dayResult = () => ({ kind: 'rejected', reason: 'El ejercicio no existe.' });
    await service.assign('x', ['martes']);
    const enviados = remote.sent.length;

    await service.syncPending();

    expect((await store.getDays())[0].status).toBe('rejected');
    expect(remote.sent.length).toBe(enviados);
  });

  it('AC-mobile-002-07: el perfil de equipamiento editado sin conexión se envía al volver', async () => {
    const { service, remote, store } = setup();
    remote.online = false;

    await service.saveEquipment(profile);
    expect((await store.getEquipment()).status).toBe('pending');

    remote.online = true;
    await service.syncEquipment();
    expect((await store.getEquipment()).status).toBe('synced');
  });

  it('AC-mobile-002-08: sin conexión y sin catálogo descargado pide conexión', async () => {
    const { service, remote } = setup();
    remote.online = false;

    expect(await service.loadCatalog()).toEqual({ sections: null, needsConnection: true });
  });

  it('AC-mobile-002-08: con el catálogo ya descargado funciona sin conexión', async () => {
    const { service, remote } = setup();
    await service.loadCatalog();
    remote.online = false;

    const result = await service.loadCatalog();

    expect(result.needsConnection).toBe(false);
    expect(result.sections).toEqual(catalog);
  });

  it('AC-mobile-002-07: hydrate trae la rutina del servidor solo si no hay cambios pendientes', async () => {
    const { service, remote, store } = setup();
    remote.fetchPlan = async () => [{ day: 'martes', entries: [{ id: 's1', exerciseId: 'a', order: 0, machineStepKg: null }] }];
    await service.hydrate();
    expect((await store.getDays())[0].entries[0].id).toBe('s1');

    remote.online = false;
    await service.assign('b', ['martes']);
    remote.fetchPlan = async () => [];
    await service.hydrate();
    expect((await store.getDays())[0].entries.map((e) => e.exerciseId)).toEqual(['a', 'b']);
  });
});
