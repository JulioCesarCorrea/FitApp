import { useCallback, useState, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { useDeps } from './DataContext';
import type { AuthState } from './authService';
import type { ProfileGate } from './profileService';
import type { SessionAdvice } from './sessionService';
import type { CatalogExercise, CatalogSection, DayState, EquipmentState, LocalExerciseLog } from './types';

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
  const { service, sessions } = useDeps();
  const [days, setDays] = useState<DayState[]>([]);

  const reload = useCallback(async () => setDays(await service.getDays()), [service]);

  const refresh = useCallback(async () => {
    await reload(); // primero lo local, para que se vea aunque no haya red
    await service.syncPending();
    await service.hydrate();
    // Los registros de sesiones pendientes también se envían al entrar (AC-mobile-003-03).
    await sessions.syncPending();
    await sessions.syncSettings();
    await reload();
  }, [service, sessions, reload]);

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

/**
 * Historial y consejo de un ejercicio. Al entrar envía lo pendiente y, con conexión y sin cambios propios por enviar,
 * trae el historial del servidor (AC-mobile-003-12).
 */
export function useSessions(exercise: CatalogExercise | undefined) {
  const { sessions } = useDeps();
  const [state, setState] = useState<{ logs: LocalExerciseLog[]; advice: SessionAdvice | null }>({ logs: [], advice: null });

  const reload = useCallback(async () => {
    if (!exercise) return;
    const logs = await sessions.loadHistory(exercise.id);
    setState({ logs, advice: await sessions.getAdvice(exercise) });
  }, [sessions, exercise]);

  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { ...state, reload };
}

/** Estado de la sesión (SPEC-mobile-004): se vuelve a pintar cuando la persona entra, sale o la sesión termina. */
export function useAuthState(): AuthState {
  const { auth } = useDeps();
  return useSyncExternalStore(auth.subscribe, auth.getState, auth.getState);
}

/** Qué muestra la app tras entrar: asistente, pedir conexión o la app (SPEC-profile-001, AC-11 y 19). */
export function useProfileGate(): ProfileGate {
  const { profile } = useDeps();
  return useSyncExternalStore(profile.subscribe, profile.getGate, profile.getGate);
}
