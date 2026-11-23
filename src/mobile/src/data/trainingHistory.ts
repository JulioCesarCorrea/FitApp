// Historial de entrenamiento (SPEC-training-006, ADR-0004). Copia de TrainingHistory.cs de la API: los casos de
// tests/Api.Tests/Training/training-history-vectors.json los ejecutan la API y esta copia. Volumen = Σ carga × repeticiones de las
// series registradas (en centésimas de kg, con enteros); una serie sin carga cuenta como serie pero no suma volumen.

import { addDays, mondayOf } from './weightStats';

/** Lo que hace falta de un registro: Heavy Duty (dos series) o 4×15 (`repsPerSet` manda). */
export interface SessionLog {
  date: string;
  loadKg: number;
  firstSetReps: number;
  secondSetReps: number;
  repsPerSet?: number[] | null;
}

export interface TrainingWeek {
  /** Lunes de la semana ISO, AAAA-MM-DD. */
  weekStart: string;
  /** Días distintos con algún registro (dos ejercicios el mismo día son una sesión). */
  sessions: number;
  sets: number;
  volumeKg: number;
  /** La semana en curso: todavía le pueden faltar sesiones. */
  partial: boolean;
}

/** Repeticiones de cada serie: las cuatro de 4×15, o la primera y la segunda de Heavy Duty. */
export const setReps = (log: SessionLog): number[] =>
  log.repsPerSet && log.repsPerSet.length > 0 ? log.repsPerSet : [log.firstSetReps, log.secondSetReps];

export const setCount = (log: SessionLog): number => setReps(log).length;

const volumeHundredths = (log: SessionLog): number => Math.round(log.loadKg * 100) * setReps(log).reduce((a, r) => a + r, 0);

/** Volumen de un registro en kg. */
export const logVolume = (log: SessionLog): number => volumeHundredths(log) / 100;

/** AC-training-006-03: solo las semanas con registros, de la más antigua a la más reciente. */
export function weeklyTraining(logs: SessionLog[]): Omit<TrainingWeek, 'partial'>[] {
  const weeks = new Map<string, SessionLog[]>();
  for (const l of logs) weeks.set(mondayOf(l.date), [...(weeks.get(mondayOf(l.date)) ?? []), l]);

  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, list]) => ({
    weekStart,
    sessions: new Set(list.map((l) => l.date)).size,
    sets: list.reduce((a, l) => a + setCount(l), 0),
    volumeKg: list.reduce((a, l) => a + volumeHundredths(l), 0) / 100,
  }));
}

/** AC-training-006-01 y 09: las últimas `count` semanas, las vacías a cero, con la semana en curso marcada como parcial. */
export function fillWeeks(weeks: Omit<TrainingWeek, 'partial'>[], count: number, today: string): TrainingWeek[] {
  const thisWeek = mondayOf(today);
  const byStart = new Map(weeks.map((w) => [w.weekStart, w]));
  return Array.from({ length: count }, (_, i) => addDays(thisWeek, -7 * (count - 1 - i))).map((start) => ({
    ...(byStart.get(start) ?? { weekStart: start, sessions: 0, sets: 0, volumeKg: 0 }),
    partial: start === thisWeek,
  }));
}
