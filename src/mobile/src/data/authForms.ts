// Validación de los formularios de cuenta (SPEC-mobile-004). Mismas reglas que la API (SPEC-auth-001).
// Sin dependencias de React Native.

export interface FormIssue {
  field: string;
  message: string;
}

const USERNAME = /^[a-z0-9._-]{3,30}$/;
export const MIN_PASSWORD = 10;
export const MAX_PASSWORD = 128;

/** La API guarda el usuario en minúsculas y sin espacios al borde. */
export const normalizeUsername = (text: string): string => text.trim().toLowerCase();

function passwordProblem(password: string, username: string): string | null {
  if (password.length < MIN_PASSWORD) return `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`;
  if (password.length > MAX_PASSWORD) return `La contraseña admite como máximo ${MAX_PASSWORD} caracteres.`;
  if (password.trim().toLowerCase() === username) return 'La contraseña no puede ser igual al nombre de usuario.';
  return null;
}

/** AC-mobile-004-02: solo se exige que haya algo escrito; no se dan pistas sobre las cuentas. */
export function validateLogin(v: { username: string; password: string }): FormIssue[] {
  const issues: FormIssue[] = [];
  if (v.username.trim() === '') issues.push({ field: 'username', message: 'Escribe tu nombre de usuario.' });
  if (v.password === '') issues.push({ field: 'password', message: 'Escribe tu contraseña.' });
  return issues;
}

/** AC-mobile-004-03. */
export function validateRegister(v: {
  username: string; password: string; confirm: string; inviteCode: string;
}): FormIssue[] {
  const issues: FormIssue[] = [];
  const username = normalizeUsername(v.username);
  if (!USERNAME.test(username)) {
    issues.push({
      field: 'username',
      message: 'El nombre de usuario debe tener de 3 a 30 caracteres: letras sin acentos, números, punto, guion o guion bajo.',
    });
  }
  const problem = passwordProblem(v.password, username);
  if (problem) issues.push({ field: 'password', message: problem });
  else if (v.confirm !== v.password) issues.push({ field: 'confirm', message: 'Las contraseñas no coinciden.' });
  if (v.inviteCode.trim() === '') issues.push({ field: 'inviteCode', message: 'Escribe el código de invitación.' });
  return issues;
}

/** AC-mobile-004-09. */
export function validateChangePassword(
  v: { current: string; next: string; confirm: string },
  username: string,
): FormIssue[] {
  const issues: FormIssue[] = [];
  if (v.current === '') issues.push({ field: 'current', message: 'Escribe tu contraseña actual.' });
  const problem = passwordProblem(v.next, normalizeUsername(username));
  if (problem) issues.push({ field: 'next', message: problem });
  else if (v.confirm !== v.next) issues.push({ field: 'confirm', message: 'Las contraseñas no coinciden.' });
  return issues;
}
