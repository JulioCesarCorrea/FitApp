import { describe, expect, it } from 'vitest';
import { formatKgList, parseKg, parseKgList } from './format';

describe('formato de kilos (SPEC-mobile-002, AC-04)', () => {
  it('lee listas con comas, punto y coma o espacios, y decimales con coma o punto', () => {
    expect(parseKgList('20, 22.5 25').values).toEqual([20, 22.5, 25]);
    expect(parseKgList('20; 22,5; 25').values).toEqual([20, 22.5, 25]);
    expect(parseKgList('').values).toEqual([]);
  });

  it('señala los fragmentos que no son números', () => {
    expect(parseKgList('20, abc, 25')).toEqual({ values: [20, 25], invalid: ['abc'] });
  });

  it('lee un solo valor; vacío es null y texto no numérico es inválido', () => {
    expect(parseKg('5')).toBe(5);
    expect(parseKg('2,5')).toBe(2.5);
    expect(parseKg('  ')).toBeNull();
    expect(parseKg('x')).toBe('invalid');
  });

  it('formatea la lista para mostrarla', () => {
    expect(formatKgList([20, 22.5])).toBe('20, 22.5');
  });
});
