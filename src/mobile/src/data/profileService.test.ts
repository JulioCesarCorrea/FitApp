import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './memoryStore';
import { ProfileService } from './profileService';
import type { LocalProfile, PutLogResult, RemoteApi } from './types';

const PROFILE: LocalProfile = {
  displayName: 'Julio', sex: 'masculino', birthDate: '1995-05-20', heightCm: 178, goal: 'ganar_musculo',
  activityLevel: 'ligero', experienceLevel: null, daysPerWeek: null, methodology: 'heavy_duty_personalizado', allergies: [],
};

interface Fake {
  online: boolean;
  server: LocalProfile | null;
  putResult: PutLogResult | null;
  calls: string[];
}

function fakeRemote(): Fake & RemoteApi {
  const r = {
    online: true,
    server: null as LocalProfile | null,
    putResult: null as PutLogResult | null,
    calls: [] as string[],
    fetchProfile: async () => {
      r.calls.push('fetch');
      if (!r.online) return null;
      return r.server ?? 'none';
    },
    putProfile: async (profile: LocalProfile): Promise<PutLogResult> => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push('put');
      if (r.putResult) return r.putResult;
      r.server = profile;
      return { kind: 'ok' };
    },
  };
  return r as unknown as Fake & RemoteApi;
}

let store: MemoryStore;
let remote: Fake & RemoteApi;
let weights: number[];
let service: ProfileService;

beforeEach(() => {
  store = new MemoryStore();
  remote = fakeRemote();
  weights = [];
  service = new ProfileService(store, remote, async (kg) => {
    weights.push(kg);
  });
});

describe('quién ve el asistente (AC-profile-001-11 y 19)', () => {
  it('AC-profile-001-11 una cuenta sin perfil en el servidor ve el asistente', async () => {
    await service.resolve();

    expect(service.getGate()).toBe('onboarding');
  });

  it('AC-profile-001-11 una cuenta con perfil en el servidor (otro teléfono) no lo ve y se guarda sincronizado', async () => {
    remote.server = PROFILE;

    await service.resolve();

    expect(service.getGate()).toBe('ready');
    expect(await store.getProfile()).toEqual({ profile: PROFILE, status: 'synced', message: null });
  });

  it('AC-profile-001-19 con perfil local entra directamente, aunque no haya conexión', async () => {
    await store.saveProfile(PROFILE);
    await store.setProfileStatus('synced', null);
    remote.online = false;

    await service.resolve();

    expect(service.getGate()).toBe('ready');
  });

  it('AC-profile-001-19 sin perfil local y sin poder consultar el servidor pide conexión y no muestra el asistente', async () => {
    remote.online = false;

    await service.resolve();

    expect(service.getGate()).toBe('needsConnection');
  });

  it('AC-profile-001-19 al reintentar con conexión sigue su camino', async () => {
    remote.online = false;
    await service.resolve();
    remote.online = true;

    await service.resolve();

    expect(service.getGate()).toBe('onboarding');
  });

  it('AC-profile-001-11 al cerrar sesión vuelve a empezar', async () => {
    await service.resolve();

    service.reset();

    expect(service.getGate()).toBe('idle');
  });

  it('AC-profile-001-11 avisa a quien escucha cuando cambia el estado', async () => {
    const seen: string[] = [];
    service.subscribe(() => seen.push(service.getGate()));

    await service.resolve();

    expect(seen).toContain('loading');
    expect(seen.at(-1)).toBe('onboarding');
  });
});

describe('guardar el perfil (AC-profile-001-16 y 17)', () => {
  it('AC-profile-001-17 guarda primero en el teléfono y lo envía', async () => {
    const outcome = await service.save(PROFILE);

    expect(outcome).toEqual({ kind: 'ok' });
    expect(remote.server).toEqual(PROFILE);
    expect(await store.getProfile()).toEqual({ profile: PROFILE, status: 'synced', message: null });
  });

  it('AC-profile-001-17 sin conexión queda pendiente y se envía una sola vez al volver', async () => {
    remote.online = false;
    expect(await service.save(PROFILE)).toEqual({ kind: 'pending' });
    expect((await store.getProfile()).status).toBe('pending');

    remote.online = true;
    await service.syncPending();
    await service.syncPending();

    expect(remote.calls.filter((c) => c === 'put')).toHaveLength(1);
    expect((await store.getProfile()).status).toBe('synced');
  });

  it('AC-profile-001-17 si la API lo rechaza queda marcado con el motivo', async () => {
    remote.putResult = { kind: 'rejected', reason: 'La estatura debe estar entre 100 y 250 cm.' };

    const outcome = await service.save(PROFILE);

    expect(outcome).toEqual({ kind: 'rejected', message: 'La estatura debe estar entre 100 y 250 cm.' });
    expect(await store.getProfile()).toMatchObject({ status: 'rejected', message: 'La estatura debe estar entre 100 y 250 cm.' });
  });

  it('AC-profile-001-17 con conexión y sin cambios pendientes toma el perfil del servidor', async () => {
    await store.saveProfile(PROFILE);
    await store.setProfileStatus('synced', null);
    remote.server = { ...PROFILE, displayName: 'Cambiado en otro teléfono' };

    await service.hydrate();

    expect((await store.getProfile()).profile?.displayName).toBe('Cambiado en otro teléfono');
  });

  it('AC-profile-001-17 un cambio propio pendiente no se pisa con el del servidor', async () => {
    remote.online = false;
    await service.save({ ...PROFILE, displayName: 'Mi cambio' });
    remote.online = true;
    remote.server = { ...PROFILE, displayName: 'Del servidor' };

    await service.hydrate();

    expect((await store.getProfile()).profile?.displayName).toBe('Mi cambio');
  });
});

describe('terminar el asistente (AC-profile-001-16)', () => {
  it('AC-profile-001-16 guarda el perfil, registra el peso y abre la app', async () => {
    await service.resolve();

    const outcome = await service.finishOnboarding(PROFILE, 80.5);

    expect(outcome).toEqual({ kind: 'ok' });
    expect(weights).toEqual([80.5]);
    expect(remote.server).toEqual(PROFILE);
    expect(service.getGate()).toBe('ready');
  });

  it('AC-profile-001-16 sin conexión el perfil queda pendiente, el peso en cola y la app se abre igualmente', async () => {
    remote.online = false;
    await service.resolve(); // sin conexión y sin perfil local no puede empezar
    expect(service.getGate()).toBe('needsConnection');
    remote.online = true;
    await service.resolve();
    remote.online = false;

    const outcome = await service.finishOnboarding(PROFILE, 80.5);

    expect(outcome).toEqual({ kind: 'pending' });
    expect(weights).toEqual([80.5]);
    expect(service.getGate()).toBe('ready');
    expect((await store.getProfile()).status).toBe('pending');
  });

  it('AC-profile-001-16 si la API rechaza el perfil no abre la app y dice el motivo', async () => {
    await service.resolve();
    remote.putResult = { kind: 'rejected', reason: 'No válido.' };

    const outcome = await service.finishOnboarding(PROFILE, 80.5);

    expect(outcome).toEqual({ kind: 'rejected', message: 'No válido.' });
    expect(service.getGate()).toBe('onboarding');
  });
});

describe('cambios sin enviar y borrado (AC-profile-001-20)', () => {
  it('AC-profile-001-20 un perfil pendiente cuenta como cambio sin enviar', async () => {
    remote.online = false;
    await service.save(PROFILE);

    expect(await store.countPendingChanges()).toBe(1);
  });

  it('AC-profile-001-20 un perfil sincronizado no cuenta', async () => {
    await service.save(PROFILE);

    expect(await store.countPendingChanges()).toBe(0);
  });

  it('AC-profile-001-20 al cerrar sesión o cambiar de cuenta el perfil local se borra', async () => {
    await service.save(PROFILE);

    await store.clearUserData();

    expect(await store.getProfile()).toEqual({ profile: null, status: 'synced', message: null });
  });
});
