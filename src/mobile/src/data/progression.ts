// Copia en TypeScript de las reglas deterministas del dominio de la API (ADR-0004): progresión de carga,
// estancamiento y cargas posibles del equipamiento. Sin dependencias de React Native.
// Los casos de tests/Api.Tests/Training/progression-vectors.json los ejecutan la API y esta copia: si una regla
// cambia, cambia primero ese archivo y la spec.

import type { EquipmentProfile } from './types';

export const REQUIRED_SETS = 2;
export const MIN_TARGET_REPS = 6;
export const TARGET_REPS = 9;
export const CEILING_REPS = 12;
export const SECOND_SET_OWN_REPS_TRIGGER = 8;
export const DEFAULT_THRESHOLD = 3;
export const MAX_DISC_PAIRS = 16;
export const MAX_MACHINE_STEPS = 100;

/** Lo que las reglas necesitan de un registro. */
export interface LogSets {
  loadKg: number;
  firstSetReps: number;
  secondSetReps: number;
  secondSetAssistedReps: number;
}

export type FirstSetEvaluation = 'por_debajo' | 'en_banda' | 'meta_alcanzada' | 'por_encima' | 'techo';

/** Evalúa las repeticiones de la serie 1 (AC-training-001-03). */
export function evaluateFirstSet(reps: number): FirstSetEvaluation {
  if (!Number.isInteger(reps) || reps < 1 || reps > CEILING_REPS) {
    throw new RangeError(`Debe estar entre 1 y ${CEILING_REPS}.`);
  }
  if (reps < MIN_TARGET_REPS) return 'por_debajo';
  if (reps < TARGET_REPS) return 'en_banda';
  if (reps === TARGET_REPS) return 'meta_alcanzada';
  if (reps < CEILING_REPS) return 'por_encima';
  return 'techo';
}

export interface LoadAdvice {
  action: 'subir' | 'mantener';
  nextLoadKg: number;
  /** Se cumplió la condición de subir, pero no hay una carga superior registrada. */
  missingLoadData: boolean;
}

/** Regla de progresión de carga (AC-training-001-07). Las repeticiones asistidas no cuentan. */
export function advise(log: LogSets, availableLoads: number[]): LoadAdvice {
  const triggered = log.firstSetReps >= CEILING_REPS && log.secondSetReps >= SECOND_SET_OWN_REPS_TRIGGER;
  if (!triggered) return { action: 'mantener', nextLoadKg: log.loadKg, missingLoadData: false };

  const higher = availableLoads.filter((l) => l > log.loadKg);
  return higher.length > 0
    ? { action: 'subir', nextLoadKg: Math.min(...higher), missingLoadData: false }
    : { action: 'mantener', nextLoadKg: log.loadKg, missingLoadData: true };
}

export interface StagnationResult {
  isStagnant: boolean;
  sessionsWithoutProgress: number;
  message: string | null;
}

// Más carga cuenta como progreso; con la misma carga, más repeticiones propias. Las asistidas no cuentan.
const improved = (previous: LogSets, current: LogSets): boolean =>
  current.loadKg > previous.loadKg ||
  (current.loadKg === previous.loadKg &&
    (current.firstSetReps > previous.firstSetReps || current.secondSetReps > previous.secondSetReps));

/**
 * Detecta estancamiento sobre el historial propio (AC-training-001-09, AC-training-003-11).
 * `history` va de la sesión más antigua a la más reciente. Bajar de carga reinicia la comparación.
 */
export function checkStagnation(history: LogSets[], threshold = DEFAULT_THRESHOLD): StagnationResult {
  if (threshold < 1) throw new RangeError('El umbral debe ser al menos 1.');

  let streak = 0;
  for (let i = history.length - 1; i >= 1; i--) {
    const previous = history[i - 1];
    const current = history[i];
    if (current.loadKg < previous.loadKg || improved(previous, current)) break;
    streak++;
  }

  const isStagnant = streak >= threshold;
  return {
    isStagnant,
    sessionsWithoutProgress: streak,
    message: isStagnant ? `Llevas ${streak} sesiones sin mejorar en este ejercicio.` : null,
  };
}

// Las sumas de discos con decimales (2.5, 1.25...) se redondean para no arrastrar error de punto flotante.
const round2 = (n: number): number => Math.round(n * 100) / 100;

const BAR_KEYS: Record<string, string> = { Recta: 'recta', Z: 'z', Smith: 'smith', RemoEnT: 'remo_en_t' };

/**
 * Cargas posibles, de menor a mayor, para el equipo de un ejercicio (EquipmentProfile.LoadsFor de la API).
 * `equipment` y `bar` son los valores del catálogo: Maquina | Mancuernas | Barra | PesoCorporal y Recta | Z | Smith | RemoEnT.
 */
export function loadsFor(
  profile: EquipmentProfile,
  equipment: string,
  bar: string | null,
  machineStepOverride: number | null = null,
): number[] {
  switch (equipment) {
    case 'PesoCorporal':
      return [];
    case 'Mancuernas':
      return [...new Set(profile.dumbbellsKg)].sort((a, b) => a - b);
    case 'Barra': {
      const barKg = bar === null ? undefined : profile.barsKg[BAR_KEYS[bar] ?? ''];
      if (bar === null) throw new Error('Una barra necesita su tipo.');
      if (barKg === undefined) return [];
      if (profile.discsKg.length > MAX_DISC_PAIRS) {
        throw new Error(`Se admiten como máximo ${MAX_DISC_PAIRS} pares de discos.`);
      }
      let sums = new Set<number>([0]);
      for (const disc of profile.discsKg) {
        sums = new Set([...sums, ...[...sums].map((s) => round2(s + disc))]);
      }
      return [...sums].map((s) => round2(barKg + 2 * s)).sort((a, b) => a - b);
    }
    default: {
      const step = machineStepOverride ?? profile.machineStepKg;
      if (!(step > 0)) return [];
      return Array.from({ length: MAX_MACHINE_STEPS }, (_, k) => round2(profile.machineBaseKg + k * step));
    }
  }
}
