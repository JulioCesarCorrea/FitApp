// Historial de peso (SPEC-progress-002, ADR-0004). Copia de WeightStats.cs de la API: los casos de
// tests/Api.Tests/Progress/progress-vectors.json los ejecutan la API y esta copia. Todo con enteros en centésimas de kilo y
// días UTC, igual que la API.

export interface WeightEntry {
  /** ISO 8601 (UTC). */
  measuredAt: string;
  weightKg: number;
}

export interface DailyWeight {
  /** AAAA-MM-DD (UTC). */
  date: string;
  weightKg: number;
}

export interface WeekStats {
  /** Lunes de la semana ISO, AAAA-MM-DD. */
  weekStart: string;
  avgKg: number;
  minKg: number;
  maxKg: number;
  count: number;
  /** Cambio del promedio respecto a la semana anterior con datos; null en la primera. */
  changeKg: number | null;
}

export type WeightRange = '30d' | '90d' | '1y' | 'all';

export const RANGE_DAYS: Record<WeightRange, number | null> = { '30d': 30, '90d': 90, '1y': 365, all: null };

const hundredths = (kg: number): number => Math.round(kg * 100);

/** AC-progress-002-01 y 02: el último peso de cada día, por fecha. */
export function dailyWeights(entries: WeightEntry[]): DailyWeight[] {
  const byDay = new Map<string, { at: number; kg: number }>();
  for (const e of entries) {
    const at = new Date(e.measuredAt).getTime();
    const day = new Date(at).toISOString().slice(0, 10);
    const previous = byDay.get(day);
    if (!previous || at >= previous.at) byDay.set(day, { at, kg: e.weightKg });
  }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, weightKg: v.kg }));
}

/**
 * AC-progress-002-02: media móvil exponencial con alfa 0,1 sobre los pesos diarios (los días sin dato no se rellenan):
 * t0 = w0 y t(i) = (w(i) + 9·t(i-1)) / 10 redondeado hacia arriba en la mitad, en centésimas. Es una estimación, no un dato registrado.
 */
export function trendSeries(daily: DailyWeight[]): DailyWeight[] {
  let previous: number | null = null;
  return daily.map((d) => {
    const w = hundredths(d.weightKg);
    const t: number = previous === null ? w : Math.floor((w + 9 * previous + 5) / 10);
    previous = t;
    return { date: d.date, weightKg: t / 100 };
  });
}

export const mondayOf = (date: string): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** AC-progress-002-05: por semana ISO (lunes a domingo) el promedio, el mínimo, el máximo y el cambio del promedio. */
export function weeklyStats(daily: DailyWeight[]): WeekStats[] {
  const weeks = new Map<string, number[]>();
  for (const d of daily) weeks.set(mondayOf(d.date), [...(weeks.get(mondayOf(d.date)) ?? []), hundredths(d.weightKg)]);

  let previousAvg: number | null = null;
  return [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, values]) => {
    const sum = values.reduce((acc, v) => acc + v, 0);
    const avg = Math.floor((2 * sum + values.length) / (2 * values.length));
    const change = previousAvg === null ? null : (avg - previousAvg) / 100;
    previousAvg = avg;
    return {
      weekStart, avgKg: avg / 100, minKg: Math.min(...values) / 100, maxKg: Math.max(...values) / 100, count: values.length, changeKg: change,
    };
  });
}

export interface WeightSummary {
  points: DailyWeight[];
  trend: DailyWeight[];
  min: number | null;
  max: number | null;
  /** Último menos primer peso del rango; null con menos de dos puntos. */
  change: number | null;
}

export const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** AC-progress-002-01 y 03: puntos del rango, mínimo, máximo, cambio y tendencia. `today` es AAAA-MM-DD (UTC). */
export function summarize(entries: WeightEntry[], range: WeightRange, today: string): WeightSummary {
  const back = RANGE_DAYS[range];
  const points = dailyWeights(entries).filter((d) => back === null || d.date >= addDays(today, -back));
  const kgs = points.map((p) => p.weightKg);
  return {
    points,
    trend: trendSeries(points),
    min: points.length === 0 ? null : Math.min(...kgs),
    max: points.length === 0 ? null : Math.max(...kgs),
    change: points.length < 2 ? null : Math.round((kgs[kgs.length - 1] - kgs[0]) * 100) / 100,
  };
}

/** Las últimas `weeks` semanas ISO con datos. */
export function recentWeeks(entries: WeightEntry[], weeks: number, today: string): WeekStats[] {
  const from = addDays(mondayOf(today), -7 * (weeks - 1));
  return weeklyStats(dailyWeights(entries)).filter((w) => w.weekStart >= from);
}
