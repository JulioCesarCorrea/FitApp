import type { LocalWeight, PostResult } from './sync';

const baseUrl = process.env.EXPO_PUBLIC_API_URL;
const devUserId = process.env.EXPO_PUBLIC_DEV_USER_ID;
const TIMEOUT_MS = 8000;

export const apiConfigured = Boolean(baseUrl && devUserId);

/** POST /weights (SPEC-progress-001). Traduce la respuesta al contrato de sync.ts. */
export async function postWeight(weight: LocalWeight): Promise<PostResult> {
  if (!baseUrl || !devUserId) return { kind: 'retry' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}/weights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': devUserId },
      body: JSON.stringify({ id: weight.id, weightKg: weight.weightKg, measuredAt: weight.measuredAt }),
      signal: controller.signal,
    });

    if (response.status === 201 || response.status === 200) return { kind: 'ok' };
    if (response.status === 400 || response.status === 409) {
      const problem = (await response.json().catch(() => null)) as { title?: string } | null;
      return { kind: 'rejected', reason: problem?.title ?? `HTTP ${response.status}` };
    }
    return { kind: 'retry' }; // 401, 5xx y cualquier otro
  } catch {
    return { kind: 'retry' }; // sin red o tiempo agotado
  } finally {
    clearTimeout(timer);
  }
}
