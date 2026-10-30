import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance, useColorScheme } from 'react-native';
import type { LocalStore } from './data/types';
import { paletteFor, parseThemeMode, type Palette, type ThemeMode } from './themeColors';

const SETTING_KEY = 'theme';

interface ThemeValue {
  colors: Palette;
  scheme: 'light' | 'dark';
  mode: ThemeMode;
  setMode(mode: ThemeMode): void;
}

const ThemeContext = createContext<ThemeValue>({
  colors: paletteFor('light'),
  scheme: 'light',
  mode: 'system',
  setMode: () => {},
});

const applyMode = (mode: ThemeMode) => {
  try {
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  } catch {
    // Entornos sin soporte (p. ej. pruebas): el tema sigue funcionando con el esquema que haya.
  }
};

/** AC-mobile-002-10: tema claro u oscuro; por defecto sigue al sistema y la elección se guarda en el teléfono. */
export function ThemeProvider({ store, children }: { store: LocalStore; children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    store.getSetting(SETTING_KEY).then((saved) => {
      const restored = parseThemeMode(saved);
      setModeState(restored);
      applyMode(restored);
    });
  }, [store]);

  const value = useMemo<ThemeValue>(() => {
    const scheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
    return {
      colors: paletteFor(scheme),
      scheme,
      mode,
      setMode: (next) => {
        setModeState(next);
        applyMode(next);
        void store.setSetting(SETTING_KEY, next);
      },
    };
  }, [mode, system, store]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
