import type { LocalProfile, LocalStore, RemoteApi } from './types';

/**
 * Qué muestra la app tras entrar (SPEC-profile-001, AC-11 y 19):
 * `idle` aún no se ha mirado, `loading` mirando, `onboarding` cuenta sin perfil (asistente),
 * `needsConnection` sin perfil local y sin poder consultar el servidor, `ready` perfil hecho.
 */
export type ProfileGate = 'idle' | 'loading' | 'onboarding' | 'ready' | 'needsConnection';

export type SaveProfileOutcome =
  | { kind: 'ok' }
  | { kind: 'pending' } // guardado en el teléfono; se enviará al volver la conexión
  | { kind: 'rejected'; message: string };

/**
 * Perfil con soporte sin conexión (P2): se guarda primero en el teléfono y luego se envía, como el perfil de equipamiento.
 * También decide si hay que mostrar el asistente de bienvenida.
 */
export class ProfileService {
  private gate: ProfileGate = 'idle';
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: LocalStore,
    private readonly remote: RemoteApi,
    /** Registra el peso del asistente en la cola de pesos (SPEC-progress-001), con su id generado en el dispositivo. */
    private readonly addWeight: (weightKg: number) => Promise<void>,
  ) {}

  getGate = (): ProfileGate => this.gate;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setGate(next: ProfileGate): void {
    if (next === this.gate) return;
    this.gate = next;
    for (const listener of this.listeners) listener();
  }

  /** Al cerrar sesión o cambiar de cuenta se vuelve a empezar. */
  reset(): void {
    this.setGate('idle');
  }

  getProfile() {
    return this.store.getProfile();
  }

  /** AC-profile-001-11 y 19. Con perfil local entra directamente; sin él pregunta al servidor. */
  async resolve(): Promise<void> {
    this.setGate('loading');

    if ((await this.store.getProfile()).profile) {
      this.setGate('ready');
      void this.refreshInBackground();
      return;
    }

    const served = await this.remote.fetchProfile();
    if (served === null) {
      this.setGate('needsConnection'); // no se sabe si ya tiene perfil: no se enseña el asistente para no pisarlo
    } else if (served === 'none') {
      this.setGate('onboarding');
    } else {
      await this.store.saveProfile(served);
      await this.store.setProfileStatus('synced', null);
      this.setGate('ready');
    }
  }

  private async refreshInBackground(): Promise<void> {
    await this.syncPending().catch(() => {});
    await this.hydrate().catch(() => {});
  }

  /** AC-profile-001-17: guarda en el teléfono y lo intenta enviar. */
  async save(profile: LocalProfile): Promise<SaveProfileOutcome> {
    await this.store.saveProfile(profile);
    return this.send(profile);
  }

  private async send(profile: LocalProfile): Promise<SaveProfileOutcome> {
    const result = await this.remote.putProfile(profile);
    if (result.kind === 'ok') {
      await this.store.setProfileStatus('synced', null);
      return { kind: 'ok' };
    }
    if (result.kind === 'rejected') {
      await this.store.setProfileStatus('rejected', result.reason);
      return { kind: 'rejected', message: result.reason };
    }
    return { kind: 'pending' };
  }

  async syncPending(): Promise<void> {
    const state = await this.store.getProfile();
    if (state.profile && state.status === 'pending') await this.send(state.profile);
  }

  /** Con conexión y sin cambios propios por enviar, toma el perfil del servidor. */
  async hydrate(): Promise<void> {
    const state = await this.store.getProfile();
    if (state.status !== 'synced') return;

    const served = await this.remote.fetchProfile();
    if (served === null || served === 'none') return;
    await this.store.saveProfile(served);
    await this.store.setProfileStatus('synced', null);
  }

  /** AC-profile-001-16: guarda el perfil, registra el peso y abre la app. Si la API rechaza el perfil, no se abre. */
  async finishOnboarding(profile: LocalProfile, weightKg: number): Promise<SaveProfileOutcome> {
    const outcome = await this.save(profile);
    if (outcome.kind === 'rejected') return outcome;

    await this.addWeight(weightKg);
    this.setGate('ready');
    return outcome;
  }
}
