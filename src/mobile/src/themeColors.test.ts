import { describe, expect, it } from 'vitest';
import { contrast, darkPalette, lightPalette, paletteFor, parseThemeMode } from './themeColors';

describe('tema (SPEC-mobile-002)', () => {
  for (const [name, p] of [['claro', lightPalette], ['oscuro', darkPalette]] as const) {
    it(`AC-mobile-002-10: el texto es legible en el tema ${name} (contraste WCAG AA, 4.5)`, () => {
      expect(contrast(p.text, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.text, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textMuted, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.textMuted, p.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.primaryText, p.primary)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.danger, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.warning, p.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.success, p.background)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it('AC-mobile-002-10: elige la paleta según el esquema', () => {
    expect(paletteFor('dark')).toBe(darkPalette);
    expect(paletteFor('light')).toBe(lightPalette);
    expect(paletteFor(null)).toBe(lightPalette);
  });

  it('AC-mobile-002-10: el ajuste guardado se interpreta, y lo desconocido vale como sistema', () => {
    expect(parseThemeMode('dark')).toBe('dark');
    expect(parseThemeMode('light')).toBe('light');
    expect(parseThemeMode(null)).toBe('system');
    expect(parseThemeMode('otro')).toBe('system');
  });
});
