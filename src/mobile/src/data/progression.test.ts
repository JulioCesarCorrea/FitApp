import { describe, expect, it } from 'vitest';
import vectors from '../../../../tests/Api.Tests/Training/progression-vectors.json';
import { advise, checkStagnation, evaluateFirstSet, loadsFor, type LogSets } from './progression';
import type { EquipmentProfile } from './types';

// Los mismos casos que ejecuta la API (ProgressionVectorsTests.cs): ADR-0004.

const toLog = (c: { loadKg: number; firstSet: number; secondSet: number; assisted: number }): LogSets => ({
  loadKg: c.loadKg,
  firstSetReps: c.firstSet,
  secondSetReps: c.secondSet,
  secondSetAssistedReps: c.assisted,
});

describe('vectores compartidos con la API (SPEC-mobile-003)', () => {
  it.each(vectors.advice)('AC-mobile-003-09 consejo de carga: $name', (c) => {
    expect(advise(toLog(c.log), c.availableLoads)).toEqual(c.expected);
  });

  it.each(vectors.loads)('AC-mobile-003-09 cargas posibles: $name', (c) => {
    const loads = loadsFor(c.profile as EquipmentProfile, c.kind, c.bar, c.stepOverride);
    expect(c.take === null ? loads : loads.slice(0, c.take)).toEqual(c.expected);
  });

  it.each(vectors.stagnation)('AC-mobile-003-10 estancamiento: $name', (c) => {
    const result = checkStagnation(c.history.map(toLog), c.threshold);
    expect(result.isStagnant).toBe(c.expected.isStagnant);
    expect(result.sessionsWithoutProgress).toBe(c.expected.sessionsWithoutProgress);
  });
});

describe('reglas de la serie 1 y mensajes', () => {
  it.each([
    [1, 'por_debajo'], [5, 'por_debajo'], [6, 'en_banda'], [8, 'en_banda'],
    [9, 'meta_alcanzada'], [10, 'por_encima'], [11, 'por_encima'], [12, 'techo'],
  ])('AC-mobile-003-09 la serie 1 con %i repeticiones es %s', (reps, expected) => {
    expect(evaluateFirstSet(reps)).toBe(expected);
  });

  it('AC-mobile-003-10 el aviso de estancamiento es una sugerencia sin calificar', () => {
    const same = toLog({ loadKg: 100, firstSet: 9, secondSet: 5, assisted: 5 });
    const result = checkStagnation([same, same, same, same], 3);

    expect(result.message).toBe('Llevas 3 sesiones sin mejorar en este ejercicio.');
    expect(checkStagnation([same, same], 3).message).toBeNull();
  });

  it('AC-mobile-003-10 el umbral por defecto es 3', () => {
    const same = toLog({ loadKg: 100, firstSet: 9, secondSet: 5, assisted: 5 });
    expect(checkStagnation([same, same, same, same]).isStagnant).toBe(true);
    expect(checkStagnation([same, same, same]).isStagnant).toBe(false);
  });

  it('AC-mobile-003-09 las cargas con decimales no acumulan error de punto flotante', () => {
    const profile = { dumbbellsKg: [], barsKg: { recta: 20 }, discsKg: [1.25, 0.1], machineStepKg: 5, machineBaseKg: 0 };
    expect(loadsFor(profile, 'Barra', 'Recta', null)).toEqual([20, 20.2, 22.5, 22.7]);
  });
});
