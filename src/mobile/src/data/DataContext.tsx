import { createContext, useContext, type ReactNode } from 'react';
import type { Deps } from './deps';

const DataContext = createContext<Deps | null>(null);

export function DataProvider({ deps, children }: { deps: Deps; children: ReactNode }) {
  return <DataContext.Provider value={deps}>{children}</DataContext.Provider>;
}

export function useDeps(): Deps {
  const deps = useContext(DataContext);
  if (!deps) throw new Error('useDeps debe usarse dentro de DataProvider.');
  return deps;
}
