// Formularios del perfil y del asistente de bienvenida (SPEC-profile-001). Mismas reglas que la API.
// Sin dependencias de React Native.

import type { FormIssue } from './authForms';
import { ageOn, isRealDate } from './dates';
import { parseKg } from './format';
import type { ActivityLevel, ExperienceLevel, Goal, LocalProfile, Sex } from './types';

export const MAX_NAME = 40;
export const MIN_AGE = 14;
export const MAX_AGE = 100;
export const MIN_HEIGHT = 100;
export const MAX_HEIGHT = 250;
export const MAX_ALLERGIES = 20;
export const MAX_ALLERGY_LENGTH = 40;
export const DEFAULT_ACTIVITY: ActivityLevel = 'ligero';
export const DEFAULT_METHODOLOGY = 'heavy_duty_personalizado';

/** Lo que la persona ha escrito o elegido hasta ahora, sin interpretar. */
export interface ProfileDraft {
  displayName: string;
  sex: Sex | null;
  birthDate: string;
  height: string;
  weight: string;
  goal: Goal | null;
  activityLevel: ActivityLevel | null;
  experienceLevel: ExperienceLevel | null;
  daysPerWeek: string;
  methodology: string;
  allergies: string;
}

export const emptyDraft = (): ProfileDraft => ({
  displayName: '', sex: null, birthDate: '', height: '', weight: '', goal: null,
  activityLevel: null, experienceLevel: null, daysPerWeek: '', methodology: DEFAULT_METHODOLOGY, allergies: '',
});

/** «nueces, lactosa» → ['nueces', 'lactosa'] (sin etiquetas vacías). */
export const parseAllergies = (text: string): string[] =>
  text.split(',').map((t) => t.trim()).filter((t) => t.length > 0);

/** Paso 1 (AC-profile-001-12). */
export function validateNameStep(d: ProfileDraft): FormIssue[] {
  const name = d.displayName.trim();
  return name.length >= 1 && name.length <= MAX_NAME
    ? []
    : [{ field: 'displayName', message: `El nombre debe tener de 1 a ${MAX_NAME} caracteres.` }];
}

/** Paso 2 (AC-profile-001-12). */
export function validateBirthStep(d: ProfileDraft, today: string): FormIssue[] {
  const issues: FormIssue[] = [];
  if (d.sex === null) issues.push({ field: 'sex', message: 'Elige tu sexo.' });

  const birth = d.birthDate.trim();
  if (!isRealDate(birth)) {
    issues.push({ field: 'birthDate', message: 'La fecha de nacimiento debe tener el formato AAAA-MM-DD.' });
  } else if (birth > today || ageOn(birth, today) < MIN_AGE || ageOn(birth, today) > MAX_AGE) {
    issues.push({ field: 'birthDate', message: `La fecha de nacimiento debe corresponder a una edad de ${MIN_AGE} a ${MAX_AGE} años.` });
  }
  return issues;
}

/** Paso 3 (AC-profile-001-12). Al editar el perfil el peso no se pide (`withWeight: false`). */
export function validateBodyStep(d: ProfileDraft, options: { withWeight?: boolean } = {}): FormIssue[] {
  const issues: FormIssue[] = [];
  const height = d.height.trim();
  if (!/^\d+$/.test(height) || Number(height) < MIN_HEIGHT || Number(height) > MAX_HEIGHT) {
    issues.push({ field: 'height', message: `La estatura debe ser un número entero entre ${MIN_HEIGHT} y ${MAX_HEIGHT} cm.` });
  }

  if (options.withWeight ?? true) {
    const weight = parseKg(d.weight);
    const tooPrecise = typeof weight === 'number' && Math.abs(Math.round(weight * 100) - weight * 100) > 1e-6;
    if (weight === null || weight === 'invalid' || !(weight > 20 && weight < 500) || tooPrecise) {
      issues.push({ field: 'weight', message: 'El peso debe estar entre 20 y 500 kg, con hasta 2 decimales.' });
    }
  }
  return issues;
}

/** Paso 4 (AC-profile-001-12). */
export function validateGoalStep(d: ProfileDraft): FormIssue[] {
  return d.goal === null ? [{ field: 'goal', message: 'Elige tu objetivo.' }] : [];
}

/** Pasos opcionales con datos escritos: días por semana y alergias (AC-profile-001-13). */
export function validateOptionalStep(d: ProfileDraft): FormIssue[] {
  const issues: FormIssue[] = [];
  const days = d.daysPerWeek.trim();
  if (days !== '' && (!/^\d+$/.test(days) || Number(days) < 1 || Number(days) > 7)) {
    issues.push({ field: 'daysPerWeek', message: 'Los días por semana deben estar entre 1 y 7.' });
  }

  const tags = parseAllergies(d.allergies);
  if (tags.length > MAX_ALLERGIES || tags.some((t) => t.length > MAX_ALLERGY_LENGTH)) {
    issues.push({ field: 'allergies', message: `Hasta ${MAX_ALLERGIES} etiquetas, de ${MAX_ALLERGY_LENGTH} caracteres como máximo.` });
  }
  return issues;
}

/** Valida todo y convierte el borrador en perfil (y peso, si se pide) (AC-profile-001-16 y 17). */
export function draftToProfile(
  d: ProfileDraft,
  today: string,
  options: { withWeight?: boolean } = {},
): { ok: true; profile: LocalProfile; weightKg: number | null } | { ok: false; issues: FormIssue[] } {
  const withWeight = options.withWeight ?? true;
  const issues = [
    ...validateNameStep(d),
    ...validateBirthStep(d, today),
    ...validateBodyStep(d, { withWeight }),
    ...validateGoalStep(d),
    ...validateOptionalStep(d),
  ];
  if (issues.length > 0) return { ok: false, issues };

  const weight = withWeight ? parseKg(d.weight) : null;
  const days = d.daysPerWeek.trim();
  return {
    ok: true,
    profile: {
      displayName: d.displayName.trim(),
      sex: d.sex as Sex,
      birthDate: d.birthDate.trim(),
      heightCm: Number(d.height.trim()),
      goal: d.goal as Goal,
      activityLevel: d.activityLevel ?? DEFAULT_ACTIVITY,
      experienceLevel: d.experienceLevel,
      daysPerWeek: days === '' ? null : Number(days),
      methodology: d.methodology || DEFAULT_METHODOLOGY,
      allergies: parseAllergies(d.allergies),
    },
    weightKg: typeof weight === 'number' ? Math.round(weight * 100) / 100 : null,
  };
}

/** Borrador para editar un perfil ya guardado (sin peso). */
export function profileToDraft(p: LocalProfile): ProfileDraft {
  return {
    displayName: p.displayName,
    sex: p.sex,
    birthDate: p.birthDate,
    height: String(p.heightCm),
    weight: '',
    goal: p.goal,
    activityLevel: p.activityLevel,
    experienceLevel: p.experienceLevel,
    daysPerWeek: p.daysPerWeek === null ? '' : String(p.daysPerWeek),
    methodology: p.methodology,
    allergies: p.allergies.join(', '),
  };
}
