import { describe, expect, it } from 'vitest';
import vectors from '../../../../tests/Api.Tests/Training/progression-vectors.json';
import { adviseNormal, checkStagnationNormal, evaluateFirstSetNormal, type NormalSets } from './progression';

// Los mismos casos que ejecuta la API (ProgressionVectorsTests.cs) para la metodología 4×15: ADR-0004.

const toLog = (c: { loadKg: number; reps: number[] }): NormalSets => ({ loadKg: c.loadKg, repsPerSet: c.reps });

describe('vectores compartidos 4×15 con la API (SPEC-training-004)', () => {
  it.each(vectors.advice4x15)('AC-training-004-10 consejo de carga: $name', (c) => {
    const advice = adviseNormal(toLog(c.log), c.availableLoads);

    expect(advice.action).toBe(c.expected.action);
    expect(advice.nextLoadKg).toBe(c.expected.nextLoadKg);
    expect(advice.missingLoadData).toBe(c.expected.missingLoadData);
    expect(evaluateFirstSetNormal(c.log.reps[0])).toBe(c.expected.firstSetEvaluation);
  });

  it.each(vectors.stagnation4x15)('AC-training-004-10 estancamiento: $name', (c) => {
    const result = checkStagnationNormal(c.history.map(toLog), c.threshold);

    expect(result.isStagnant).toBe(c.expected.isStagnant);
    expect(result.sessionsWithoutProgress).toBe(c.expected.sessionsWithoutProgress);
  });
});

describe('reglas de 4×15', () => {
  it('AC-training-004-06 la serie 1 fuera de 1 a 15 no es válida', () => {
    expect(() => evaluateFirstSetNormal(0)).toThrow(RangeError);
    expect(() => evaluateFirstSetNormal(16)).toThrow(RangeError);
  });

  it('AC-training-004-05 un registro sin las 4 series no sube', () => {
    expect(adviseNormal({ loadKg: 20, repsPerSet: [15, 15, 15] }, [25]).action).toBe('mantener');
  });

  it('AC-training-004-07 el aviso de estancamiento es una sugerencia sin calificar', () => {
    const same = { loadKg: 40, repsPerSet: [12, 12, 12, 10] };

    const result = checkStagnationNormal([same, same, same, same], 3);

    expect(result.message).toBe('Llevas 3 sesiones sin mejorar en este ejercicio.');
  });
});
