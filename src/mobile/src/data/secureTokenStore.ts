import * as SecureStore from 'expo-secure-store';
import type { AuthTokenStore, AuthUser, StoredSession } from './authService';

// Claves del almacén seguro (Keychain en iOS, Keystore en Android). Solo admiten letras, números, «.», «-» y «_».
const ACCESS = 'auth.access';
const REFRESH = 'auth.refresh';
const EXPIRES = 'auth.expiresAt';
const USER = 'auth.user';

/** Sesión guardada en el almacén seguro del teléfono (SPEC-mobile-004). Nunca en SQLite ni en logs. */
export class SecureTokenStore implements AuthTokenStore {
  async load(): Promise<StoredSession | null> {
    const [accessToken, refreshToken, expiresAt, user] = await Promise.all([
      SecureStore.getItemAsync(ACCESS),
      SecureStore.getItemAsync(REFRESH),
      SecureStore.getItemAsync(EXPIRES),
      SecureStore.getItemAsync(USER),
    ]);
    if (!accessToken || !refreshToken || !expiresAt || !user) return null;

    try {
      return { accessToken, refreshToken, expiresAt: Number(expiresAt), user: JSON.parse(user) as AuthUser };
    } catch {
      return null; // datos dañados: se trata como sin sesión
    }
  }

  async save(session: StoredSession): Promise<void> {
    await SecureStore.setItemAsync(ACCESS, session.accessToken);
    await SecureStore.setItemAsync(REFRESH, session.refreshToken);
    await SecureStore.setItemAsync(EXPIRES, String(session.expiresAt));
    await SecureStore.setItemAsync(USER, JSON.stringify(session.user));
  }

  async clear(): Promise<void> {
    await Promise.all([ACCESS, REFRESH, EXPIRES, USER].map((key) => SecureStore.deleteItemAsync(key)));
  }
}
