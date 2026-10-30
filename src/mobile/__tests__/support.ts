import { MemoryStore } from '../src/data/memoryStore';
import { PlanService } from '../src/data/planService';
import { SessionService } from '../src/data/sessionService';
import type {
  CatalogSection, DayKey, EquipmentProfile, LocalPlanEntry, PutDayResult, PutEquipmentResult, RemoteApi,
} from '../src/data/types';

export const CATALOG: CatalogSection[] = [
  {
    name: 'Pecho',
    exercises: [
      { id: 'press-plano-con-barra', name: 'Press plano con barra', primaryZone: 'pecho', secondaryZones: [], movements: [], equipment: 'Barra', bar: 'Recta', images: ['/exercise-images/press-plano-con-barra-0.jpg', '/exercise-images/press-plano-con-barra-1.jpg'] },
      { id: 'press-de-pecho-en-maquina', name: 'Press de pecho en máquina', primaryZone: 'pecho', secondaryZones: [], movements: [], equipment: 'Maquina', bar: null, images: ['/exercise-images/press-de-pecho-en-maquina-0.jpg'] },
    ],
  },
  {
    name: 'Hombros',
    exercises: [
      { id: 'elevaciones-laterales-con-mancuernas', name: 'Elevaciones laterales con mancuernas', primaryZone: 'hombro_lateral', secondaryZones: [], movements: [], equipment: 'Mancuernas', bar: null, images: ['/exercise-images/elevaciones-laterales-con-mancuernas-0.jpg'] },
    ],
  },
];

export const PROFILE: EquipmentProfile = {
  dumbbellsKg: [20, 22.5], barsKg: { recta: 20 }, discsKg: [2.5, 5], machineStepKg: 5, machineBaseKg: 0,
};

export interface FakeRemote extends RemoteApi {
  online: boolean;
  sent: { day: DayKey; entries: LocalPlanEntry[]; confirm: boolean }[];
  dayResult: (day: DayKey, confirm: boolean) => PutDayResult;
  equipmentResult: PutEquipmentResult;
}

export function createFakes() {
  let n = 0;
  const store = new MemoryStore();
  // Lo que «tiene el servidor»: las pruebas lo siembran con seedServer y putDay lo actualiza.
  const server = new Map<DayKey, LocalPlanEntry[]>();
  const remote: FakeRemote = {
    online: true,
    sent: [],
    equipmentResult: { kind: 'ok' },
    dayResult: () => ({ kind: 'ok', entries: [] }),
    putLog: async () => ({ kind: 'retry' }),
    deleteLog: async () => 'retry',
    fetchHistory: async () => null,
    fetchTrainingSettings: async () => null,
    putTrainingSettings: async () => ({ kind: 'retry' }),
    fetchCatalog: async () => (remote.online ? CATALOG : null),
    fetchPlan: async () =>
      remote.online ? [...server.entries()].filter(([, e]) => e.length > 0).map(([day, entries]) => ({ day, entries })) : null,
    fetchEquipment: async () => (remote.online ? 'none' : null),
    putDay: async (day, entries, confirm) => {
      if (!remote.online) return { kind: 'retry' };
      remote.sent.push({ day, entries, confirm });
      const result = remote.dayResult(day, confirm);
      if (result.kind === 'ok') server.set(day, entries);
      return result;
    },
    putEquipment: async () => (remote.online ? remote.equipmentResult : { kind: 'retry' }),
    imageUrl: (path) => `http://api.test${path}`,
  };
  const service = new PlanService(store, remote, () => `id-${++n}`);
  const sessions = new SessionService(store, remote, () => `log-${++n}`, () => '2026-10-30');
  /** Deja una rutina ya sincronizada: en el servidor y en el teléfono. */
  const seedServer = async (day: DayKey, entries: LocalPlanEntry[]) => {
    server.set(day, entries);
    await store.replaceDaySynced(day, entries);
  };
  return { store, remote, service, sessions, seedServer, deps: { store, remote, service, sessions } };
}
