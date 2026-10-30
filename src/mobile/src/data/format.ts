/** Convierte «20, 22,5; 25» en [20, 22.5, 25]. `invalid` lista los fragmentos que no son números. */
export function parseKgList(text: string): { values: number[]; invalid: string[] } {
  const parts = text.split(/[;\s]+|,(?=\s)/).map((p) => p.trim()).filter(Boolean);
  const values: number[] = [];
  const invalid: string[] = [];
  for (const part of parts) {
    const n = Number(part.replace(',', '.'));
    if (Number.isFinite(n)) values.push(n);
    else invalid.push(part);
  }
  return { values, invalid };
}

/** Un solo número en kg; vacío vale null. */
export function parseKg(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : 'invalid';
}

export const formatKgList = (values: number[]): string => values.join(', ');
