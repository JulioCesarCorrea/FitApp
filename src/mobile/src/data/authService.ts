import type { Authorizer } from './authedFetch';
import {
  normalizeUsername, validateChangePassword, validateLogin, validateRegister, type FormIssue,
} from './authForms';
import type { LocalStore } from './types';

// SPEC-mobile-004. Sin dependencias de React Native: se prueba en Node con un almacén de tokens y un cliente simulados.

export interface AuthUser {
  id: string;
  username: string;
  mustChangePassword: boolean;
}

/** Lo que se guarda en el almacén seguro. Nunca en SQLite ni en logs. */
export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  /** Instante (ms desde 1970) en que caduca el token de acceso. */
  expiresAt: number;
  user: AuthUser;
}

export interface AuthTokenStore {
  load(): Promise<StoredSession | null>;
  save(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/** Almacén de tokens en memoria, para las pruebas. */
export class MemoryTokenStore implements AuthTokenStore {
  failLoad = false;

  constructor(public session: StoredSession | null = null) {}

  async load() {
    if (this.failLoad) throw new Error('almacén seguro no disponible');
    return this.session;
  }

  async save(session: StoredSession) {
    this.session = session;
  }

  async clear() {
    this.session = null;
  }
}

export interface AuthResponseBody {
  accessToken: string;
  refreshToken: string;
  /** Segundos de vida del token de acceso. */
  expiresIn: number;
  user: AuthUser;
}

export type AuthResult =
  | { kind: 'ok'; body: AuthResponseBody }
  | { kind: 'rejected'; status: number; reason: string } // 400, 401, 403, 404, 409
  | { kind: 'locked'; retryAfterSeconds: number | null } // 429
  | { kind: 'network' }; // sin conexión, tiempo agotado, 5xx

/** Cliente de /auth/* (HTTP en la app, simulado en las pruebas). */
export interface AuthRemote {
  register(username: string, password: string, inviteCode: string): Promise<AuthResult>;
  login(username: string, password: string): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  /** Mejor esfuerzo: nunca falla hacia fuera. */
  logout(refreshToken: string): Promise<void>;
  changePassword(accessToken: string, currentPassword: string, newPassword: string): Promise<AuthResult>;
}

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; notice: string | null }
  | { status: 'signedIn'; user: AuthUser };

export type SignInOutcome =
  | { kind: 'ok' }
  | { kind: 'invalid'; issues: FormIssue[] }
  | { kind: 'rejected'; message: string }
  | { kind: 'locked'; message: string }
  | { kind: 'network'; message: string }
  /** Hay cambios sin enviar de otra cuenta: hace falta confirmar antes de borrarlos. */
  | { kind: 'confirmReplace'; pending: number };

export type ChangePasswordOutcome =
  | { kind: 'ok' }
  | { kind: 'invalid'; issues: FormIssue[] }
  | { kind: 'rejected'; message: string }
  | { kind: 'network'; message: string };

const REFRESH_MARGIN_MS = 30_000;
const LOCAL_USER_KEY = 'localUserId';
export const NETWORK_MESSAGE = 'Necesitas conexión con el servidor para entrar.';
export const EXPIRED_NOTICE = 'Tu sesión terminó. Entra de nuevo.';

const lockedMessage = (seconds: number | null): string => {
  if (seconds === null) return 'Demasiados intentos. Espera unos minutos antes de volver a probar.';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Demasiados intentos. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} antes de volver a probar.`;
};

const sameUser = (a: AuthUser, b: AuthUser) =>
  a.id === b.id && a.username === b.username && a.mustChangePassword === b.mustChangePassword;

/**
 * Sesión de la persona: entrar, crear cuenta, renovar tokens, cerrar sesión y cambiar contraseña.
 * Implementa Authorizer: las llamadas a la API le piden el token (AC-mobile-004-05 y 11).
 */
export class AuthService implements Authorizer {
  private state: AuthState = { status: 'loading' };
  private session: StoredSession | null = null;
  private refreshing: Promise<'ok' | 'network' | 'expired'> | null = null;
  private awaiting: AuthResponseBody | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly tokens: AuthTokenStore,
    private readonly remote: AuthRemote,
    private readonly store: LocalStore,
    private readonly now: () => number = Date.now,
  ) {}

  getState = (): AuthState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private setState(next: AuthState): void {
    const prev = this.state;
    const same =
      prev.status === next.status &&
      (next.status === 'signedIn' ? sameUser((prev as { user: AuthUser }).user, next.user)
        : next.status === 'signedOut' ? (prev as { notice: string | null }).notice === next.notice
          : true);
    if (same) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /** AC-mobile-004-04: lee la sesión guardada; no necesita conexión. */
  async restore(): Promise<void> {
    try {
      this.session = await this.tokens.load();
    } catch {
      this.session = null; // el almacén seguro falló: se trata como sin sesión
    }
    this.setState(this.session
      ? { status: 'signedIn', user: this.session.user }
      : { status: 'signedOut', notice: null });
  }

  /** AC-mobile-004-02 y 12. */
  async signIn(username: string, password: string): Promise<SignInOutcome> {
    const issues = validateLogin({ username, password });
    if (issues.length > 0) return { kind: 'invalid', issues };
    return this.complete(await this.remote.login(normalizeUsername(username), password));
  }

  /** AC-mobile-004-03 y 12. */
  async register(input: { username: string; password: string; confirm: string; inviteCode: string }): Promise<SignInOutcome> {
    const issues = validateRegister(input);
    if (issues.length > 0) return { kind: 'invalid', issues };
    return this.complete(await this.remote.register(normalizeUsername(input.username), input.password, input.inviteCode.trim()));
  }

  private async complete(result: AuthResult): Promise<SignInOutcome> {
    switch (result.kind) {
      case 'network':
        return { kind: 'network', message: NETWORK_MESSAGE };
      case 'locked':
        return { kind: 'locked', message: lockedMessage(result.retryAfterSeconds) };
      case 'rejected':
        return { kind: 'rejected', message: result.reason };
      default:
        return this.adopt(result.body);
    }
  }

  /** AC-mobile-004-07: si el teléfono tiene datos de otra cuenta, se borran; con cambios sin enviar, antes se confirma. */
  private async adopt(body: AuthResponseBody): Promise<SignInOutcome> {
    const owner = await this.store.getSetting(LOCAL_USER_KEY);
    if (owner && owner !== body.user.id) {
      const pending = await this.store.countPendingChanges();
      if (pending > 0) {
        this.awaiting = body;
        return { kind: 'confirmReplace', pending };
      }
      await this.store.clearUserData();
    }
    await this.finish(body);
    return { kind: 'ok' };
  }

  async confirmReplace(): Promise<SignInOutcome> {
    const body = this.awaiting;
    if (!body) return { kind: 'rejected', message: 'No hay nada que confirmar.' };
    this.awaiting = null;
    await this.store.clearUserData();
    await this.finish(body);
    return { kind: 'ok' };
  }

  /** La persona no quiere perder los cambios de la otra cuenta: se cierra la sesión recién abierta y no se borra nada. */
  async cancelReplace(): Promise<void> {
    const body = this.awaiting;
    this.awaiting = null;
    if (body) await this.remote.logout(body.refreshToken).catch(() => {});
    this.setState({ status: 'signedOut', notice: null });
  }

  private async finish(body: AuthResponseBody): Promise<void> {
    await this.store.setSetting(LOCAL_USER_KEY, body.user.id);
    await this.persist(body);
  }

  private async persist(body: AuthResponseBody): Promise<void> {
    const session: StoredSession = {
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresAt: this.now() + body.expiresIn * 1000,
      user: body.user,
    };
    this.session = session;
    try {
      await this.tokens.save(session);
    } catch {
      // Si el almacén seguro falla, la sesión vale solo hasta cerrar la app.
    }
    this.setState({ status: 'signedIn', user: body.user });
  }

  /** AC-mobile-004-05: token vigente; lo renueva si le quedan menos de 30 s. Null sin sesión o sin poder renovar. */
  async token(): Promise<string | null> {
    if (!this.session) return null;
    if (this.session.expiresAt - this.now() > REFRESH_MARGIN_MS) return this.session.accessToken;
    return (await this.refreshOnce()) === 'ok' ? this.session?.accessToken ?? null : null;
  }

  /** Tras un 401: si otra llamada ya renovó, entrega el token actual sin gastar otra renovación. */
  async refresh(staleToken: string): Promise<string | null> {
    if (!this.session) return null;
    if (this.session.accessToken !== staleToken) return this.session.accessToken;
    return (await this.refreshOnce()) === 'ok' ? this.session?.accessToken ?? null : null;
  }

  // El token de renovación se gasta al usarse: dos renovaciones a la vez cerrarían la sesión.
  private refreshOnce(): Promise<'ok' | 'network' | 'expired'> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<'ok' | 'network' | 'expired'> {
    const current = this.session;
    if (!current) return 'expired';

    const result = await this.remote.refresh(current.refreshToken);
    if (result.kind === 'ok') {
      await this.persist(result.body);
      return 'ok';
    }
    if (result.kind === 'rejected') {
      await this.expire();
      return 'expired';
    }
    return 'network'; // sin conexión: la sesión sigue y la llamada queda pendiente
  }

  /** AC-mobile-004-06: la sesión terminó. Se piden credenciales de nuevo, pero los datos del teléfono no se tocan. */
  private async expire(): Promise<void> {
    this.session = null;
    await this.tokens.clear().catch(() => {});
    this.setState({ status: 'signedOut', notice: EXPIRED_NOTICE });
  }

  /** AC-mobile-004-07 y 08: cambios sin enviar de la cuenta actual. */
  pendingChanges(): Promise<number> {
    return this.store.countPendingChanges();
  }

  /** AC-mobile-004-08: revoca la sesión (si hay conexión), borra los tokens y los datos del teléfono. */
  async signOut(): Promise<void> {
    const session = this.session;
    if (session) await this.remote.logout(session.refreshToken).catch(() => {});
    this.session = null;
    await this.tokens.clear().catch(() => {});
    await this.store.clearUserData();
    this.setState({ status: 'signedOut', notice: null });
  }

  /** AC-mobile-004-09 y 10. */
  async changePassword(form: { current: string; next: string; confirm: string }): Promise<ChangePasswordOutcome> {
    if (!this.session) return { kind: 'rejected', message: EXPIRED_NOTICE };
    const issues = validateChangePassword(form, this.session.user.username);
    if (issues.length > 0) return { kind: 'invalid', issues };

    const token = await this.token();
    if (!token) {
      return this.session
        ? { kind: 'network', message: 'Necesitas conexión con el servidor para cambiar la contraseña.' }
        : { kind: 'rejected', message: EXPIRED_NOTICE };
    }

    const result = await this.remote.changePassword(token, form.current, form.next);
    switch (result.kind) {
      case 'ok':
        await this.persist(result.body);
        return { kind: 'ok' };
      case 'rejected':
        return { kind: 'rejected', message: result.reason };
      case 'locked':
        return { kind: 'rejected', message: lockedMessage(result.retryAfterSeconds) };
      default:
        return { kind: 'network', message: 'Necesitas conexión con el servidor para cambiar la contraseña.' };
    }
  }
}
