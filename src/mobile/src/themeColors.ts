// Paletas de colores claro y oscuro (AC-mobile-002-10). Sin dependencias de React Native.

export interface Palette {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  warning: string;
  success: string;
}

export const lightPalette: Palette = {
  background: '#FFFFFF',
  surface: '#F3F4F6',
  text: '#111827',
  textMuted: '#4B5563',
  border: '#D1D5DB',
  primary: '#1D4ED8',
  primaryText: '#FFFFFF',
  danger: '#B91C1C',
  warning: '#92400E',
  success: '#166534',
};

export const darkPalette: Palette = {
  background: '#0B0F14',
  surface: '#151B23',
  text: '#F3F4F6',
  textMuted: '#9CA3AF',
  border: '#374151',
  primary: '#60A5FA',
  primaryText: '#0B0F14',
  danger: '#F87171',
  warning: '#FBBF24',
  success: '#4ADE80',
};

export type ThemeMode = 'system' | 'light' | 'dark';

export const paletteFor = (scheme: 'light' | 'dark' | null | undefined): Palette =>
  scheme === 'dark' ? darkPalette : lightPalette;

/** Interpreta el valor guardado en ajustes; cualquier otra cosa vale como «sistema». */
export const parseThemeMode = (value: string | null): ThemeMode =>
  value === 'light' || value === 'dark' ? value : 'system';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG entre dos colores #RRGGBB. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
