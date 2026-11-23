// Historial de nutrición (SPEC-nutrition-006, ADR-0004). Copia de NutritionHistory.cs de la API: los casos `weekly` de
// tests/Api.Tests/Nutrition/nutrition-vectors.json los ejecutan la API y esta copia. Cálculo por enteros (décimas de gramo).

import { mondayOf } from './weightStats';

/** Lo comido en un día con algún registro: los días sin registro no cuentan. */
export interface DayIntake {
  date: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface WeekIntake {
  /** Lunes de la semana ISO, AAAA-MM-DD. */
  weekStart: string;
  daysLogged: number;
  avgKcal: number;
  avgProteinG: number;
  avgFatG: number;
  avgCarbsG: number;
  /** Días dentro del margen de las calorías objetivo; null sin objetivo. */
  daysOnTarget: number | null;
}

/** Margen de adherencia: ±10 % de las calorías objetivo. */
export const onTarget = (kcal: number, targetKcal: number): boolean => Math.abs(kcal - targetKcal) * 10 <= targetKcal;

const tenths = (v: number): number => Math.round(v * 10);
const avg = (sum: number, n: number): number => Math.floor((2 * sum + n) / (2 * n));

/** AC-nutrition-006-02 y 03: promedios por semana ISO solo sobre los días con registro y días dentro del margen. */
export function weeklyIntake(loggedDays: DayIntake[], targetKcal: number | null): WeekIntake[] {
  const weeks = new Map<string, DayIntake[]>();
  for (const d of loggedDays) weeks.set(mondayOf(d.date), [...(weeks.get(mondayOf(d.date)) ?? []), d]);

  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, days]) => {
    const n = days.length;
    const sum = (pick: (d: DayIntake) => number) => days.reduce((acc, d) => acc + pick(d), 0);
    return {
      weekStart,
      daysLogged: n,
      avgKcal: avg(sum((d) => d.kcal), n),
      avgProteinG: avg(sum((d) => tenths(d.proteinG)), n) / 10,
      avgFatG: avg(sum((d) => tenths(d.fatG)), n) / 10,
      avgCarbsG: avg(sum((d) => tenths(d.carbsG)), n) / 10,
      daysOnTarget: targetKcal === null ? null : days.filter((d) => onTarget(d.kcal, targetKcal)).length,
    };
  });
}
