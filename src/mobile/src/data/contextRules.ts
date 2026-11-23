// Reglas del contexto personal (SPEC-profile-002). Copiadas de la API (Domain/Profile/ContextItem.cs); los vectores de
// tests/Api.Tests/Profile/context-vectors.json las mantienen iguales (ADR-0004).

export const CONTEXT_TYPES = ['suplemento', 'habito', 'medicacion', 'nota'] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];

export const CONTEXT_FREQUENCIES = ['diario', 'dias_alternos', 'semanal', 'segun_necesidad'] as const;
export type ContextFrequency = (typeof CONTEXT_FREQUENCIES)[number];

export const MAX_NAME = 60;
export const MAX_BRAND = 40;
export const MAX_DOSE = 40;
export const MAX_NOTE = 280;
/** AC-08: entradas activas por persona. */
export const MAX_ACTIVE = 50;

/** AC-01: activa es la entrada sin baja o con la baja en el futuro (fechas «YYYY-MM-DD»). */
export function isActive(endedOn: string | null, today: string): boolean {
  return endedOn === null || endedOn > today;
}

/** AC-04 y 15: patrones evidentes de dato personal (correo, enlace, usuario de red social o 7+ dígitos seguidos). */
export function looksPersonal(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return false;
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/i.test(text) || /(https?:\/\/|www\.)\S+/i.test(text) || /(^|\s)@\w{3,}/.test(text)) return true;

  let digits = 0;
  for (const c of text) {
    if (c >= '0' && c <= '9') digits += 1;
    else if (!' -.+()'.includes(c)) digits = 0;
    if (digits >= 7) return true;
  }
  return false;
}
