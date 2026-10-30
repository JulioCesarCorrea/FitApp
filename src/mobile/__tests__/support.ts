import { AuthService, MemoryTokenStore, type AuthRemote, type AuthResult, type StoredSession } from '../src/data/authService';
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

export interface FakeAuthRemote extends AuthRemote {
  online: boolean;
  calls: string[];
  accounts: Map<string, { id: string; password: string; mustChange: boolean }>;
  locked: boolean;
  inviteCode: string;
}

/** Servidor de cuentas simulado (SPEC-auth-001): lo justo para recorrer las pantallas. */
function createAuthRemote(): FakeAuthRemote {
  let n = 0;
  const r: FakeAuthRemote = {
    online: true,
    calls: [],
    locked: false,
    inviteCode: 'codigo-bueno',
    accounts: new Map([
      ['julio', { id: 'user-1', password: 'contraseña-segura-1', mustChange: false }],
      ['ana', { id: 'user-2', password: 'otra-contraseña-9', mustChange: false }],
    ]),
    register: async (username, password, inviteCode) => {
      if (!r.online) return { kind: 'network' };
      r.calls.push(`register:${username}`);
      if (inviteCode !== r.inviteCode) return { kind: 'rejected', status: 403, reason: 'El código de invitación no es válido.' };
      if (r.accounts.has(username)) return { kind: 'rejected', status: 409, reason: 'Ese nombre de usuario ya está en uso.' };
      r.accounts.set(username, { id: `id-${username}`, password, mustChange: false });
      return issue(username);
    },
    login: async (username, password) => {
      if (!r.online) return { kind: 'network' };
      r.calls.push(`login:${username}`);
      if (r.locked) return { kind: 'locked', retryAfterSeconds: 600 };
      const account = r.accounts.get(username);
      if (!account || account.password !== password) return { kind: 'rejected', status: 401, reason: 'Usuario o contraseña incorrectos.' };
      return issue(username);
    },
    refresh: async () => (r.online ? { kind: 'rejected', status: 401, reason: 'La sesión ya no es válida. Entra de nuevo.' } : { kind: 'network' }),
    logout: async () => {
      r.calls.push('logout');
    },
    changePassword: async (_token, current, next) => {
      if (!r.online) return { kind: 'network' };
      const entry = [...r.accounts].find(([, a]) => a.password === current);
      if (!entry) return { kind: 'rejected', status: 400, reason: 'La contraseña actual no es correcta.' };
      entry[1].password = next;
      entry[1].mustChange = false;
      return issue(entry[0]);
    },
  };

  function issue(username: string): AuthResult {
    n++;
    const account = r.accounts.get(username)!;
    return {
      kind: 'ok',
      body: {
        accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 3600,
        user: { id: account.id, username, mustChangePassword: account.mustChange },
      },
    };
  }

  return r;
}

export const SESSION: StoredSession = {
  accessToken: 'access-0', refreshToken: 'refresh-0', expiresAt: Date.now() + 3600 * 1000,
  user: { id: 'user-1', username: 'julio', mustChangePassword: false },
};

/** `signedIn: false` deja el teléfono sin sesión; por defecto las pruebas arrancan con la sesión de «julio» ya iniciada. */
export function createFakes(options: { signedIn?: boolean; session?: StoredSession } = {}) {
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
  const authRemote = createAuthRemote();
  const tokens = new MemoryTokenStore(options.signedIn === false ? null : (options.session ?? SESSION));
  const auth = new AuthService(tokens, authRemote, store);
  /** Deja una rutina ya sincronizada: en el servidor y en el teléfono. */
  const seedServer = async (day: DayKey, entries: LocalPlanEntry[]) => {
    server.set(day, entries);
    await store.replaceDaySynced(day, entries);
  };
  return { store, remote, service, sessions, auth, authRemote, tokens, seedServer, deps: { store, remote, service, sessions, auth } };
}
