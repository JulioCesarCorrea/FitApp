import { authedFetch, type Authorizer } from './data/authedFetch';
import type { LocalWeight, PostResult } from './sync';

const baseUrl = process.env.EXPO_PUBLIC_API_URL;

export const apiConfigured = Boolean(baseUrl);

// SPEC-mobile-004: quien entrega el token de la sesión. Lo fija createDeps al arrancar.
let authorizer: Authorizer | null = null;
export function setAuthorizer(value: Authorizer | null): void {
  authorizer = value;
}

interface ProblemDetails {
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>; // 400 de validación: campo -> mensajes
}

/** Prefiere el detalle de validación al título genérico de ProblemDetails. */
export function reasonFrom(problem: ProblemDetails | null, status: number): string {
  const messages = Object.values(problem?.errors ?? {}).flat();
  if (messages.length > 0) return messages.join(' ');
  return problem?.detail ?? problem?.title ?? `HTTP ${status}`;
}

/** POST /weights (SPEC-progress-001). Traduce la respuesta al contrato de sync.ts. */
export async function postWeight(weight: LocalWeight): Promise<PostResult> {
  if (!baseUrl || !authorizer) return { kind: 'retry' };

  // AC-mobile-004-11: con el token de la sesión; sin sesión o sin red devuelve null y queda pendiente.
  const response = await authedFetch(authorizer, `${baseUrl}/weights`, {
    method: 'POST',
    body: JSON.stringify({ id: weight.id, weightKg: weight.weightKg, measuredAt: weight.measuredAt }),
  });
  if (!response) return { kind: 'retry' };

  if (response.status === 201 || response.status === 200) return { kind: 'ok' };
  if (response.status === 400 || response.status === 409) {
    const problem = (await response.json().catch(() => null)) as ProblemDetails | null;
    return { kind: 'rejected', reason: reasonFrom(problem, response.status) };
  }
  return { kind: 'retry' }; // 401, 5xx y cualquier otro
}
