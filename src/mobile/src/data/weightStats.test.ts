import { describe, expect, it } from 'vitest';
import vectors from '../../../../tests/Api.Tests/Progress/progress-vectors.json';
import { dailyWeights, recentWeeks, summarize, trendSeries, weeklyStats } from './weightStats';

// Los mismos casos que ejecuta la API (WeightVectorsTests): ADR-0004.

describe('vectores compartidos con la API (SPEC-progress-002)', () => {
  it.each(vectors.series)('AC-progress-002-02 peso diario, tendencia y resumen semanal: $name', (c) => {
    const daily = dailyWeights(c.entries);

    expect(daily).toEqual(c.daily);
    expect(trendSeries(daily)).toEqual(c.trend);
    expect(weeklyStats(daily)).toEqual(c.weekly);
  });
});

const entry = (date: string, kg: number, hour = 8) => ({ measuredAt: `${date}T${String(hour).padStart(2, '0')}:00:00Z`, weightKg: kg });

describe('resumen por rango (AC-progress-002-01 y 03)', () => {
  const entries = [entry('2026-07-20', 82), entry('2026-11-03', 81), entry('2026-11-13', 80), entry('2026-11-20', 80.5)];

  it('trae los puntos del rango, el mínimo, el máximo, el cambio y la tendencia', () => {
    const month = summarize(entries, '30d', '2026-11-23');

    expect(month.points.map((p) => p.weightKg)).toEqual([81, 80, 80.5]);
    expect([month.min, month.max, month.change]).toEqual([80, 81, -0.5]);
    expect(month.trend[0].weightKg).toBe(81);
  });

  it('el rango «todo» incluye todo el historial y «1y» un año atrás', () => {
    expect(summarize(entries, 'all', '2026-11-23').points).toHaveLength(4);
    expect(summarize(entries, '1y', '2026-11-23').points).toHaveLength(4);
    expect(summarize(entries, '90d', '2026-11-23').points).toHaveLength(3);
  });

  it('sin pesos o con uno solo no hay cambio ni error', () => {
    expect(summarize([], '30d', '2026-11-23')).toEqual({ points: [], trend: [], min: null, max: null, change: null });
    expect(summarize([entry('2026-11-20', 80)], '30d', '2026-11-23')).toMatchObject({ min: 80, max: 80, change: null });
  });

  it('con varios pesos el mismo día cuenta el último', () => {
    const day = summarize([entry('2026-11-20', 81, 7), entry('2026-11-20', 80.4, 21)], '30d', '2026-11-23');

    expect(day.points).toEqual([{ date: '2026-11-20', weightKg: 80.4 }]);
  });

  it('AC-progress-002-05 las últimas semanas con datos', () => {
    const weeks = recentWeeks(entries, 4, '2026-11-23'); // lunes 2026-11-23: desde el lunes 2026-11-02

    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16']);
    expect(weeks[1].changeKg).toBe(-1);
  });
});
