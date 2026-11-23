import { describe, expect, it } from 'vitest';
import vectors from '../../../../tests/Api.Tests/Training/training-history-vectors.json';
import { fillWeeks, logVolume, setCount, weeklyTraining } from './trainingHistory';

// Los mismos casos que ejecuta la API (TrainingHistoryVectorsTests): ADR-0004.

describe('vectores compartidos con la API (SPEC-training-006)', () => {
  it.each(vectors.cases)('AC-training-006-03 series, volumen y resumen semanal: $name', (c) => {
    expect(c.logs.map(logVolume)).toEqual(c.volumes);
    expect(c.logs.map(setCount)).toEqual(c.sets);
    expect(weeklyTraining(c.logs)).toEqual(c.weekly);
  });
});

describe('semanas rellenas (AC-training-006-01 y 09)', () => {
  it('rellena a cero las semanas sin sesiones y marca la semana en curso como parcial', () => {
    const weeks = weeklyTraining([{ date: '2026-11-10', loadKg: 20, firstSetReps: 10, secondSetReps: 8 }]);

    const filled = fillWeeks(weeks, 3, '2026-11-13'); // jueves; la semana en curso empieza el lunes 2026-11-09

    expect(filled).toEqual([
      { weekStart: '2026-10-26', sessions: 0, sets: 0, volumeKg: 0, partial: false },
      { weekStart: '2026-11-02', sessions: 0, sets: 0, volumeKg: 0, partial: false },
      { weekStart: '2026-11-09', sessions: 1, sets: 2, volumeKg: 360, partial: true },
    ]);
  });

  it('sin sesiones todas las semanas van a cero', () => {
    expect(fillWeeks([], 2, '2026-11-13').map((w) => [w.sessions, w.sets, w.volumeKg])).toEqual([[0, 0, 0], [0, 0, 0]]);
  });
});
