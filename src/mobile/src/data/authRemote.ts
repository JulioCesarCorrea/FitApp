import { reasonFrom } from '../api';
import type { AuthRemote, AuthResponseBody, AuthResult } from './authService';

const TIMEOUT_MS = 8000;

/** Cliente HTTP de /auth/* (SPEC-auth-001). Traduce las respuestas al contrato de AuthRemote. */
export class HttpAuthRemote implements AuthRemote {
  constructor(private readonly baseUrl: string | undefined = process.env.EXPO_PUBLIC_API_URL) {}

  register(username: string, password: string, inviteCode: string): Promise<AuthResult> {
    return this.post('/auth/register', { username, password, inviteCode }, [201]);
  }

  login(username: string, password: string): Promise<AuthResult> {
    return this.post('/auth/login', { username, password }, [200]);
  }

  refresh(refreshToken: string): Promise<AuthResult> {
    return this.post('/auth/refresh', { refreshToken }, [200]);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.send('/auth/logout', { refreshToken }); // mejor esfuerzo: sin conexión no pasa nada
  }

  changePassword(accessToken: string, currentPassword: string, newPassword: string): Promise<AuthResult> {
    return this.post('/auth/change-password', { currentPassword, newPassword }, [200], accessToken);
  }

  private async post(path: string, body: unknown, okStatuses: number[], accessToken?: string): Promise<AuthResult> {
    const res = await this.send(path, body, accessToken);
    if (!res) return { kind: 'network' };

    if (okStatuses.includes(res.status)) return { kind: 'ok', body: (await res.json()) as AuthResponseBody };
    if (res.status === 429) {
      const seconds = Number(res.headers.get('Retry-After'));
      return { kind: 'locked', retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
    }
    if ([400, 401, 403, 404, 409].includes(res.status)) {
      const problem = await res.json().catch(() => null);
      return { kind: 'rejected', status: res.status, reason: reasonFrom(problem, res.status) };
    }
    return { kind: 'network' }; // 5xx y cualquier otro: se reintentará
  }

  private async send(path: string, body: unknown, accessToken?: string): Promise<Response | null> {
    if (!this.baseUrl) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      return null; // sin red o tiempo agotado
    } finally {
      clearTimeout(timer);
    }
  }
}
