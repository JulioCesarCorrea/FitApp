// Llamadas a la API con el token de la sesión (SPEC-mobile-004). Sin dependencias de React Native.

/** Quien entrega el token de acceso vigente y sabe renovarlo (lo implementa AuthService). */
export interface Authorizer {
  /** Token vigente, renovado si hacía falta; null si no hay sesión o no se pudo renovar. */
  token(): Promise<string | null>;
  /** Tras un 401 con `staleToken`: token nuevo, o null si la sesión no se pudo renovar. */
  refresh(staleToken: string): Promise<string | null>;
}

const DEFAULT_TIMEOUT_MS = 8000;

async function send(url: string, init: RequestInit & { timeoutMs?: number }, token: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch {
    return null; // sin red o tiempo agotado
  } finally {
    clearTimeout(timer);
  }
}

/**
 * AC-mobile-004-05 y 11. Llama con `Authorization: Bearer`; ante un 401 renueva la sesión y repite la llamada una sola vez.
 * Devuelve null sin token (no se envía nada) o sin conexión; el llamador lo trata como «reintentar más tarde».
 */
export async function authedFetch(
  auth: Authorizer,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response | null> {
  const token = await auth.token();
  if (!token) return null;

  const first = await send(url, init, token);
  if (first === null || first.status !== 401) return first;

  const renewed = await auth.refresh(token);
  if (!renewed) return first;
  return send(url, init, renewed);
}
