import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDeps } from './DataContext';
import type { CatalogExercise, CatalogSection, DayState, EquipmentState } from './types';

export function findExercise(sections: CatalogSection[] | null, id: string): CatalogExercise | undefined {
  return sections?.flatMap((s) => s.exercises).find((e) => e.id === id);
}

/** Catálogo: lo descarga y lo guarda; sin conexión usa el guardado (AC-mobile-002-07/08). */
export function useCatalog() {
  const { service } = useDeps();
  const [state, setState] = useState<{ sections: CatalogSection[] | null; needsConnection: boolean; loading: boolean }>({
    sections: null,
    needsConnection: false,
    loading: true,
  });

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    const { sections, needsConnection } = await service.loadCatalog();
    setState({ sections, needsConnection, loading: false });
  }, [service]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { ...state, reload };
}

/** Rutina por día. Al entrar intenta traer lo del servidor y enviar lo pendiente. */
export function useDays() {
  const { service } = useDeps();
  const [days, setDays] = useState<DayState[]>([]);

  const reload = useCallback(async () => setDays(await service.getDays()), [service]);

  const refresh = useCallback(async () => {
    await reload(); // primero lo local, para que se vea aunque no haya red
    await service.syncPending();
    await service.hydrate();
    await reload();
  }, [service, reload]);

  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return { days, reload, refresh };
}

export function useEquipment() {
  const { store, service } = useDeps();
  const [state, setState] = useState<EquipmentState>({ profile: null, status: 'synced', message: null });

  const reload = useCallback(async () => setState(await store.getEquipment()), [store]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        await reload();
        await service.syncEquipment();
        await service.hydrate();
        await reload();
      })();
    }, [service, reload]),
  );
  return { ...state, reload };
}
