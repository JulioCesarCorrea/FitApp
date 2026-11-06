// Fechas en formato AAAA-MM-DD (día local). Sin dependencias de React Native.

/** ¿Es una fecha AAAA-MM-DD que existe en el calendario? */
export function isRealDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

export function addDays(text: string, days: number): string {
  const [y, mo, d] = text.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** Edad cumplida en `today` (misma cuenta que la API). */
export function ageOn(birth: string, today: string): number {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age;
}
