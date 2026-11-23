import { describe, expect, it } from 'vitest';
import vectors from '../../../../tests/Api.Tests/Profile/context-vectors.json';
import { isActive, looksPersonal } from './contextRules';

describe('contextRules (SPEC-profile-002)', () => {
  it.each(vectors.personal)('AC-profile-002-04 y 15 vectores de datos personales en notas: $text', (c) => {
    expect(looksPersonal(c.text)).toBe(c.expected);
  });

  it('AC-profile-002-01: activa es sin baja o con la baja en el futuro', () => {
    expect(isActive(null, '2026-11-23')).toBe(true);
    expect(isActive('2026-11-24', '2026-11-23')).toBe(true);
    expect(isActive('2026-11-23', '2026-11-23')).toBe(false);
    expect(isActive('2026-11-01', '2026-11-23')).toBe(false);
  });
});
