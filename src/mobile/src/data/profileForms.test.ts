import { describe, expect, it } from 'vitest';
import {
  draftToProfile, emptyDraft, profileToDraft,
  validateBirthStep, validateBodyStep, validateGoalStep, validateNameStep, validateOptionalStep,
  type ProfileDraft,
} from './profileForms';

const TODAY = '2026-10-30';
const draft = (over: Partial<ProfileDraft> = {}): ProfileDraft => ({
  ...emptyDraft(), displayName: 'Julio', sex: 'masculino', birthDate: '1995-05-20', height: '178', weight: '80,5',
  goal: 'ganar_musculo', ...over,
});
const fields = (issues: { field: string }[]) => issues.map((i) => i.field);

describe('paso 1: nombre (AC-profile-001-12)', () => {
  it('AC-profile-001-12 acepta de 1 a 40 caracteres y rechaza vacío o más de 40', () => {
    expect(validateNameStep(draft({ displayName: ' J ' }))).toEqual([]);
    expect(fields(validateNameStep(draft({ displayName: '   ' })))).toEqual(['displayName']);
    expect(fields(validateNameStep(draft({ displayName: 'a'.repeat(41) })))).toEqual(['displayName']);
    expect(validateNameStep(draft({ displayName: 'a'.repeat(40) }))).toEqual([]);
  });
});

describe('paso 2: sexo y nacimiento (AC-profile-001-12)', () => {
  it('AC-profile-001-12 exige el sexo', () => {
    expect(fields(validateBirthStep(draft({ sex: null }), TODAY))).toEqual(['sex']);
  });

  it.each([
    ['1995-05-20', true],
    ['2012-10-30', true], // 14 años justos
    ['2012-10-31', false], // 13 años y 364 días
  ])('AC-profile-001-12 la fecha %s (válida: %s) respeta la edad mínima de 14 años', (birthDate, expected) => {
    expect(validateBirthStep(draft({ birthDate }), TODAY).length === 0).toBe(expected);
  });

  it('AC-profile-001-12 rechaza fechas con formato incorrecto, inexistentes o futuras', () => {
    for (const birthDate of ['20/05/1995', '1995-02-30', '2030-01-01', '', 'abc']) {
      expect(fields(validateBirthStep(draft({ birthDate }), TODAY))).toEqual(['birthDate']);
    }
  });

  it('AC-profile-001-12 100 años cumplidos es el máximo', () => {
    expect(validateBirthStep(draft({ birthDate: '1926-10-30' }), TODAY)).toEqual([]);
    expect(fields(validateBirthStep(draft({ birthDate: '1925-10-31' }), TODAY))).toEqual([]); // aún 100
    expect(fields(validateBirthStep(draft({ birthDate: '1925-10-30' }), TODAY))).toEqual(['birthDate']);
  });
});

describe('paso 3: estatura y peso (AC-profile-001-12)', () => {
  it('AC-profile-001-12 acepta una estatura entera de 100 a 250 y un peso de más de 20 y menos de 500', () => {
    expect(validateBodyStep(draft())).toEqual([]);
    expect(validateBodyStep(draft({ height: '100', weight: '20,5' }))).toEqual([]);
    expect(validateBodyStep(draft({ height: '250', weight: '499.99' }))).toEqual([]);
  });

  it.each([
    ['estatura de 99', { height: '99' }, 'height'],
    ['estatura de 251', { height: '251' }, 'height'],
    ['estatura con decimales', { height: '178.5' }, 'height'],
    ['estatura vacía', { height: '' }, 'height'],
    ['peso de 20', { weight: '20' }, 'weight'],
    ['peso de 500', { weight: '500' }, 'weight'],
    ['peso con 3 decimales', { weight: '80.123' }, 'weight'],
    ['peso que no es un número', { weight: 'ochenta' }, 'weight'],
    ['peso vacío', { weight: '' }, 'weight'],
  ] as const)('AC-profile-001-12 rechaza %s', (_name, over, field) => {
    expect(fields(validateBodyStep(draft(over)))).toEqual([field]);
  });

  it('AC-profile-001-17 al editar el perfil el peso no se pide', () => {
    expect(validateBodyStep(draft({ weight: '' }), { withWeight: false })).toEqual([]);
  });
});

describe('paso 4: objetivo (AC-profile-001-12)', () => {
  it('AC-profile-001-12 exige elegir uno', () => {
    expect(fields(validateGoalStep(draft({ goal: null })))).toEqual(['goal']);
    expect(validateGoalStep(draft())).toEqual([]);
  });
});

describe('pasos opcionales (AC-profile-001-13)', () => {
  it('AC-profile-001-13 los días por semana son de 1 a 7 o quedan vacíos', () => {
    expect(validateOptionalStep(draft({ daysPerWeek: '' }))).toEqual([]);
    expect(validateOptionalStep(draft({ daysPerWeek: '4' }))).toEqual([]);
    for (const daysPerWeek of ['0', '8', '2.5', 'x']) {
      expect(fields(validateOptionalStep(draft({ daysPerWeek })))).toEqual(['daysPerWeek']);
    }
  });

  it('AC-profile-001-13 las alergias admiten hasta 20 etiquetas de 40 caracteres, separadas por comas', () => {
    expect(validateOptionalStep(draft({ allergies: 'nueces, lactosa' }))).toEqual([]);
    expect(validateOptionalStep(draft({ allergies: '' }))).toEqual([]);
    expect(fields(validateOptionalStep(draft({ allergies: 'x'.repeat(41) })))).toEqual(['allergies']);
    expect(fields(validateOptionalStep(draft({ allergies: Array.from({ length: 21 }, (_, i) => `a${i}`).join(',') })))).toEqual(['allergies']);
  });
});

describe('del borrador al perfil (AC-profile-001-16 y 17)', () => {
  it('AC-profile-001-16 convierte el borrador en perfil y peso con los valores por defecto', () => {
    const result = draftToProfile(draft(), TODAY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toEqual({
      displayName: 'Julio', sex: 'masculino', birthDate: '1995-05-20', heightCm: 178, goal: 'ganar_musculo',
      activityLevel: 'ligero', experienceLevel: null, daysPerWeek: null, methodology: 'heavy_duty_personalizado', allergies: [],
    });
    expect(result.weightKg).toBe(80.5);
  });

  it('AC-profile-001-16 conserva los opcionales contestados y recorta etiquetas', () => {
    const result = draftToProfile(
      draft({ displayName: '  Julio C ', activityLevel: 'moderado', experienceLevel: 'intermedio', daysPerWeek: '4', allergies: ' nueces , lactosa ,, ' }),
      TODAY,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile).toMatchObject({
      displayName: 'Julio C', activityLevel: 'moderado', experienceLevel: 'intermedio', daysPerWeek: 4, allergies: ['nueces', 'lactosa'],
    });
  });

  it('AC-profile-001-16 con datos inválidos devuelve los motivos', () => {
    const result = draftToProfile(draft({ displayName: '', height: '5' }), TODAY);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(fields(result.issues)).toEqual(['displayName', 'height']);
  });

  it('AC-profile-001-17 al editar no exige peso y el borrador se reconstruye desde el perfil', () => {
    const base = draftToProfile(draft({ daysPerWeek: '3', allergies: 'nueces' }), TODAY);
    if (!base.ok) throw new Error('perfil base inválido');

    const back = profileToDraft(base.profile);
    const again = draftToProfile(back, TODAY, { withWeight: false });

    expect(back).toMatchObject({ displayName: 'Julio', height: '178', daysPerWeek: '3', allergies: 'nueces', weight: '' });
    expect(again.ok && again.profile).toEqual(base.profile);
    expect(again.ok && again.weightKg).toBeNull();
  });
});
