import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuthService, MemoryTokenStore,
  type AuthRemote, type AuthResponseBody, type AuthResult, type AuthUser, type StoredSession,
} from './authService';
import { MemoryStore } from './memoryStore';

const NOW = 1_800_000_000_000;
const HOUR = 3600 * 1000;

interface Account { id: string; password: string; mustChange: boolean }

interface FakeAuthRemote extends AuthRemote {
  online: boolean;
  calls: string[];
  accounts: Map<string, Account>;
  validRefresh: Map<string, string>; // token de renovación -> id de usuario
  locked: boolean;
  inviteCode: string;
}

function fakeRemote(): FakeAuthRemote {
  let n = 0;
  const r: FakeAuthRemote = {
    online: true,
    calls: [],
    accounts: new Map(),
    validRefresh: new Map(),
    locked: false,
    inviteCode: 'codigo-bueno',
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
      if (!account || account.password !== password) {
        return { kind: 'rejected', status: 401, reason: 'Usuario o contraseña incorrectos.' };
      }
      return issue(username);
    },
    refresh: async (refreshToken) => {
      r.calls.push('refresh');
      if (!r.online) return { kind: 'network' };
      const id = r.validRefresh.get(refreshToken);
      if (!id) return { kind: 'rejected', status: 401, reason: 'La sesión ya no es válida. Entra de nuevo.' };
      r.validRefresh.delete(refreshToken);
      const username = [...r.accounts].find(([, a]) => a.id === id)![0];
      return issue(username);
    },
    logout: async (refreshToken) => {
      r.calls.push('logout');
      r.validRefresh.delete(refreshToken);
    },
    changePassword: async (_accessToken, current, next) => {
      if (!r.online) return { kind: 'network' };
      r.calls.push('change-password');
      const entry = [...r.accounts].find(([, a]) => a.password === current);
      if (!entry) return { kind: 'rejected', status: 400, reason: 'La contraseña actual no es correcta.' };
      entry[1].password = next;
      entry[1].mustChange = false;
      return issue(entry[0]);
    },
  };

  function issue(username: string): AuthResult {
    const account = r.accounts.get(username)!;
    n++;
    r.validRefresh.set(`refresh-${n}`, account.id);
    const body: AuthResponseBody = {
      accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 3600,
      user: { id: account.id, username, mustChangePassword: account.mustChange },
    };
    return { kind: 'ok', body };
  }

  return r;
}

let tokens: MemoryTokenStore;
let remote: FakeAuthRemote;
let store: MemoryStore;
let clock: number;
let auth: AuthService;

beforeEach(() => {
  clock = NOW;
  tokens = new MemoryTokenStore();
  remote = fakeRemote();
  store = new MemoryStore();
  auth = new AuthService(tokens, remote, store, () => clock);
  remote.accounts.set('julio', { id: 'id-julio', password: 'contraseña-segura-1', mustChange: false });
  remote.accounts.set('ana', { id: 'id-ana', password: 'otra-contraseña-9', mustChange: false });
});

const register = { username: 'nuevo.user', password: 'contraseña-segura-1', confirm: 'contraseña-segura-1', inviteCode: 'codigo-bueno' };

const userOf = (): AuthUser | null => {
  const s = auth.getState();
  return s.status === 'signedIn' ? s.user : null;
};

/** Deja datos de una cuenta en el teléfono, como si ya se hubieran usado. */
async function seedLocalData(owner: string, pending = false) {
  await store.setSetting('localUserId', owner);
  await store.setSetting('theme', 'dark');
  await store.saveCatalog([{ name: 'Pecho', exercises: [] }]);
  await store.saveDay('martes', [{ id: 'p1', exerciseId: 'press', order: 0, machineStepKg: null }]);
  if (!pending) await store.setDayStatus('martes', 'synced', null);
}

describe('entrar (AC-mobile-004-02, 12)', () => {
  it('AC-mobile-004-02 guarda la sesión y la app queda con la persona dentro', async () => {
    const outcome = await auth.signIn('julio', 'contraseña-segura-1');

    expect(outcome).toEqual({ kind: 'ok' });
    expect(userOf()).toEqual({ id: 'id-julio', username: 'julio', mustChangePassword: false });
    expect(tokens.session).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1', user: { id: 'id-julio' } });
    expect(await store.getSetting('localUserId')).toBe('id-julio');
  });

  it('AC-mobile-004-02 con datos incorrectos muestra el mensaje de la API y no guarda sesión', async () => {
    const outcome = await auth.signIn('julio', 'mal');

    expect(outcome).toEqual({ kind: 'rejected', message: 'Usuario o contraseña incorrectos.' });
    expect(auth.getState().status).not.toBe('signedIn');
    expect(tokens.session).toBeNull();
  });

  it('AC-mobile-004-02 con campos vacíos no envía nada', async () => {
    const outcome = await auth.signIn('  ', '');

    expect(outcome.kind).toBe('invalid');
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-004-02 con la cuenta bloqueada indica cuánto esperar', async () => {
    remote.locked = true;

    const outcome = await auth.signIn('julio', 'contraseña-segura-1');

    expect(outcome.kind).toBe('locked');
    if (outcome.kind === 'locked') expect(outcome.message).toMatch(/10 minutos/);
    expect(tokens.session).toBeNull();
  });

  it('AC-mobile-004-12 sin conexión dice que hace falta conexión, no que la contraseña sea incorrecta', async () => {
    remote.online = false;

    const outcome = await auth.signIn('julio', 'contraseña-segura-1');

    expect(outcome).toEqual({ kind: 'network', message: 'Necesitas conexión con el servidor para entrar.' });
  });
});

describe('crear cuenta (AC-mobile-004-03, 12)', () => {
  it('AC-mobile-004-03 crea la cuenta y entra', async () => {
    const outcome = await auth.register(register);

    expect(outcome).toEqual({ kind: 'ok' });
    expect(userOf()?.username).toBe('nuevo.user');
    expect(remote.calls).toEqual(['register:nuevo.user']);
  });

  it.each([
    ['usuario corto', { username: 'ab' }],
    ['contraseña corta', { password: 'corta', confirm: 'corta' }],
    ['repetición distinta', { confirm: 'otra' }],
    ['sin código', { inviteCode: '' }],
  ])('AC-mobile-004-03 valida en el teléfono (%s) y no envía nada', async (_name, over) => {
    const outcome = await auth.register({ ...register, ...over });

    expect(outcome.kind).toBe('invalid');
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-004-03 un código incorrecto o un usuario ya usado muestran el motivo', async () => {
    const badCode = await auth.register({ ...register, inviteCode: 'otro' });
    const taken = await auth.register({ ...register, username: 'julio' });

    expect(badCode).toEqual({ kind: 'rejected', message: 'El código de invitación no es válido.' });
    expect(taken).toEqual({ kind: 'rejected', message: 'Ese nombre de usuario ya está en uso.' });
  });

  it('AC-mobile-004-12 sin conexión dice que hace falta conexión', async () => {
    remote.online = false;

    expect((await auth.register(register)).kind).toBe('network');
  });
});

describe('sesión guardada (AC-mobile-004-04)', () => {
  const stored: StoredSession = {
    accessToken: 'a', refreshToken: 'r', expiresAt: NOW + HOUR,
    user: { id: 'id-julio', username: 'julio', mustChangePassword: false },
  };

  it('AC-mobile-004-04 al abrir la app entra directamente, aunque no haya conexión', async () => {
    tokens = new MemoryTokenStore(stored);
    auth = new AuthService(tokens, remote, store, () => clock);
    remote.online = false;

    await auth.restore();

    expect(userOf()?.username).toBe('julio');
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-004-04 sin sesión guardada queda fuera', async () => {
    await auth.restore();

    expect(auth.getState()).toEqual({ status: 'signedOut', notice: null });
  });

  it('AC-mobile-004-04 si el almacén seguro falla, queda fuera sin romper la app', async () => {
    tokens = new MemoryTokenStore(stored);
    tokens.failLoad = true;
    auth = new AuthService(tokens, remote, store, () => clock);

    await auth.restore();

    expect(auth.getState().status).toBe('signedOut');
  });

  it('AC-mobile-004-04 avisa a quien escucha cuando cambia la sesión', async () => {
    const seen: string[] = [];
    auth.subscribe(() => seen.push(auth.getState().status));

    await auth.signIn('julio', 'contraseña-segura-1');

    expect(seen).toContain('signedIn');
  });
});

describe('renovación automática (AC-mobile-004-05)', () => {
  beforeEach(async () => {
    await auth.signIn('julio', 'contraseña-segura-1');
    remote.calls.length = 0;
  });

  it('AC-mobile-004-05 con el token vigente no renueva', async () => {
    expect(await auth.token()).toBe('access-1');
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-004-05 con menos de 30 segundos de vida lo renueva y guarda el par nuevo', async () => {
    clock = NOW + HOUR - 10_000;

    expect(await auth.token()).toBe('access-2');
    expect(remote.calls).toEqual(['refresh']);
    expect(tokens.session).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' });
  });

  it('AC-mobile-004-05 varias llamadas a la vez comparten una sola renovación', async () => {
    clock = NOW + HOUR + 1;

    const results = await Promise.all([auth.token(), auth.token(), auth.token(), auth.token(), auth.token()]);

    expect(remote.calls.filter((c) => c === 'refresh')).toHaveLength(1);
    expect(new Set(results)).toEqual(new Set(['access-2']));
    expect(auth.getState().status).toBe('signedIn');
  });

  it('AC-mobile-004-05 tras un 401 renueva, pero si otro ya renovó entrega el token actual sin gastar otra renovación', async () => {
    clock = NOW + HOUR + 1;
    await auth.token(); // access-2

    const again = await auth.refresh('access-1');

    expect(again).toBe('access-2');
    expect(remote.calls.filter((c) => c === 'refresh')).toHaveLength(1);
  });

  it('AC-mobile-004-05 tras un 401 con el token actual hace una renovación nueva', async () => {
    const renewed = await auth.refresh('access-1');

    expect(renewed).toBe('access-2');
  });

  it('AC-mobile-004-05 sin conexión no cierra la sesión: la llamada queda pendiente', async () => {
    clock = NOW + HOUR + 1;
    remote.online = false;

    expect(await auth.token()).toBeNull();
    expect(auth.getState().status).toBe('signedIn');
    expect(tokens.session).not.toBeNull();
  });

  it('AC-mobile-004-05 el token de renovación nunca se muestra en el estado', () => {
    expect(JSON.stringify(auth.getState())).not.toContain('refresh-1');
  });
});

describe('sesión expirada (AC-mobile-004-06)', () => {
  it('AC-mobile-004-06 si la API rechaza la renovación vuelve a Entrar con un aviso y sin borrar los datos', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');
    await seedLocalData('id-julio', true);
    remote.validRefresh.clear(); // sesión revocada en el servidor
    clock = NOW + HOUR + 1;

    expect(await auth.token()).toBeNull();

    const state = auth.getState();
    expect(state.status).toBe('signedOut');
    if (state.status === 'signedOut') expect(state.notice).toMatch(/sesión terminó/i);
    expect(tokens.session).toBeNull();
    expect((await store.getDays()).map((d) => d.day)).toEqual(['martes']);
    expect(await store.getSetting('localUserId')).toBe('id-julio');
  });

  it('AC-mobile-004-06 si la misma persona entra de nuevo conserva lo que tenía sin enviar', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');
    await seedLocalData('id-julio', true);
    remote.validRefresh.clear();
    clock = NOW + HOUR + 1;
    await auth.token();

    const outcome = await auth.signIn('julio', 'contraseña-segura-1');

    expect(outcome).toEqual({ kind: 'ok' });
    expect((await store.getDays())[0]).toMatchObject({ day: 'martes', status: 'pending' });
  });
});

describe('otra cuenta en el mismo teléfono (AC-mobile-004-07)', () => {
  it('AC-mobile-004-07 al entrar otra cuenta se borran los datos de la anterior y se conservan el tema y el catálogo', async () => {
    await seedLocalData('id-julio');

    const outcome = await auth.signIn('ana', 'otra-contraseña-9');

    expect(outcome).toEqual({ kind: 'ok' });
    expect(await store.getDays()).toEqual([]);
    expect(await store.getSetting('theme')).toBe('dark');
    expect(await store.getCatalog()).not.toBeNull();
    expect(await store.getSetting('localUserId')).toBe('id-ana');
  });

  it('AC-mobile-004-07 con cambios sin enviar de la anterior pide confirmación y no entra hasta recibirla', async () => {
    await seedLocalData('id-julio', true);

    const outcome = await auth.signIn('ana', 'otra-contraseña-9');

    expect(outcome).toEqual({ kind: 'confirmReplace', pending: 1 });
    expect(auth.getState().status).not.toBe('signedIn');
    expect(tokens.session).toBeNull();
    expect((await store.getDays()).length).toBe(1);
  });

  it('AC-mobile-004-07 al confirmar se borran los datos de la anterior y se entra', async () => {
    await seedLocalData('id-julio', true);
    await auth.signIn('ana', 'otra-contraseña-9');

    const outcome = await auth.confirmReplace();

    expect(outcome).toEqual({ kind: 'ok' });
    expect(userOf()?.username).toBe('ana');
    expect(await store.getDays()).toEqual([]);
  });

  it('AC-mobile-004-07 al cancelar no se entra, se cierra la sesión recién abierta y no se borra nada', async () => {
    await seedLocalData('id-julio', true);
    await auth.signIn('ana', 'otra-contraseña-9');

    await auth.cancelReplace();

    expect(auth.getState().status).not.toBe('signedIn');
    expect(remote.calls).toContain('logout');
    expect(remote.validRefresh.size).toBe(0);
    expect(tokens.session).toBeNull();
    expect((await store.getDays())[0]).toMatchObject({ day: 'martes', status: 'pending' });
    expect(await store.getSetting('localUserId')).toBe('id-julio');
  });

  it('AC-mobile-004-07 si el teléfono no recuerda de quién son los datos (versión anterior), los conserva', async () => {
    await store.saveDay('martes', [{ id: 'p1', exerciseId: 'press', order: 0, machineStepKg: null }]);

    await auth.signIn('julio', 'contraseña-segura-1');

    expect((await store.getDays()).length).toBe(1);
    expect(await store.getSetting('localUserId')).toBe('id-julio');
  });

  it('AC-mobile-004-07 cuentan como cambios sin enviar el equipo, los registros, el umbral y los pesos pendientes', async () => {
    await store.saveEquipment({ dumbbellsKg: [20], barsKg: {}, discsKg: [], machineStepKg: 5, machineBaseKg: 0 });
    await store.saveLog({
      id: 'l1', exerciseId: 'press', date: '2026-10-01', loadKg: 20, firstSetReps: 9, secondSetReps: 5,
      secondSetAssistedReps: 5, status: 'pending', message: null, pendingOp: 'upsert', attempted: false,
    });
    await store.setSetting('stagnationThresholdStatus', 'pending');
    store.pendingWeights = 2;

    expect(await auth.pendingChanges()).toBe(5);
  });

  it('AC-mobile-004-07 los registros y días rechazados no cuentan como pendientes', async () => {
    await store.saveDay('martes', []);
    await store.setDayStatus('martes', 'rejected', 'No');

    expect(await auth.pendingChanges()).toBe(0);
  });
});

describe('cerrar sesión (AC-mobile-004-08)', () => {
  it('AC-mobile-004-08 revoca la sesión, borra los tokens y los datos del teléfono y vuelve a Entrar', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');
    await seedLocalData('id-julio', true);
    remote.calls.length = 0;

    await auth.signOut();

    expect(remote.calls).toEqual(['logout']);
    expect(remote.validRefresh.size).toBe(0);
    expect(tokens.session).toBeNull();
    expect(await store.getDays()).toEqual([]);
    expect(await store.getSetting('localUserId')).toBeNull();
    expect(await store.getSetting('theme')).toBe('dark');
    expect(auth.getState()).toEqual({ status: 'signedOut', notice: null });
  });

  it('AC-mobile-004-08 sin conexión igualmente cierra y borra en el teléfono', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');
    remote.online = false;

    await auth.signOut();

    expect(tokens.session).toBeNull();
    expect(auth.getState().status).toBe('signedOut');
  });
});

describe('cambiar contraseña (AC-mobile-004-09, 10)', () => {
  const form = { current: 'contraseña-segura-1', next: 'nueva-contraseña-2', confirm: 'nueva-contraseña-2' };

  it('AC-mobile-004-09 se valida en el teléfono antes de enviar', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');
    remote.calls.length = 0;

    const outcome = await auth.changePassword({ ...form, confirm: 'distinta' });

    expect(outcome.kind).toBe('invalid');
    expect(remote.calls).toEqual([]);
  });

  it('AC-mobile-004-09 envía el cambio y guarda los tokens nuevos', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');

    const outcome = await auth.changePassword(form);

    expect(outcome).toEqual({ kind: 'ok' });
    expect(tokens.session?.accessToken).toBe('access-2');
    expect(remote.accounts.get('julio')?.password).toBe('nueva-contraseña-2');
  });

  it('AC-mobile-004-09 una actual incorrecta muestra el motivo de la API', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');

    const outcome = await auth.changePassword({ ...form, current: 'no-es-esta-actual' });

    expect(outcome).toEqual({ kind: 'rejected', message: 'La contraseña actual no es correcta.' });
  });

  it('AC-mobile-004-09 sin conexión lo indica y no cambia nada', async () => {
    await auth.signIn('julio', 'contraseña-segura-1');
    remote.online = false;

    expect((await auth.changePassword(form)).kind).toBe('network');
    expect(remote.accounts.get('julio')?.password).toBe('contraseña-segura-1');
  });

  it('AC-mobile-004-10 con cambio obligatorio la sesión lo marca hasta cambiar la contraseña', async () => {
    remote.accounts.set('temporal', { id: 'id-temporal', password: 'Temporal-12345', mustChange: true });

    await auth.signIn('temporal', 'Temporal-12345');
    expect(userOf()?.mustChangePassword).toBe(true);

    const outcome = await auth.changePassword({ current: 'Temporal-12345', next: 'definitiva-contraseña-3', confirm: 'definitiva-contraseña-3' });

    expect(outcome).toEqual({ kind: 'ok' });
    expect(userOf()?.mustChangePassword).toBe(false);
    expect(tokens.session?.user.mustChangePassword).toBe(false);
  });
});

describe('aislamiento de tokens (AC-mobile-004-11)', () => {
  it('AC-mobile-004-11 sin sesión no hay token', async () => {
    expect(await auth.token()).toBeNull();
  });
});
