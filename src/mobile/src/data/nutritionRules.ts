// Reglas de nutrición que la app calcula sin conexión (SPEC-nutrition-001, ADR-0004): el redondeo de lo comido por
// cantidad y los totales. El objetivo diario lo calcula solo la API; la app guarda el último que recibe.
// Los casos de tests/Api.Tests/Nutrition/nutrition-vectors.json los ejecutan la API y esta copia.

export const FIXED_MEALS = ['desayuno', 'almuerzo', 'cena', 'snack'] as const;
export const MEAL_MAX_LENGTH = 30;
export const MIN_GRAMS = 1;
export const MAX_GRAMS = 5000;

export interface Portion {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

// Los valores por 100 g llevan como máximo un decimal: se calcula con enteros (décimas) para no arrastrar error de
// punto flotante y dar exactamente lo mismo que la API.
const tenths = (value: number): number => Math.round(value * 10);

/** Calorías y macros de una cantidad de alimento: calorías enteras y macros con un decimal (AC-nutrition-001-10). */
export function portionOf(
  kcalPer100g: number, proteinPer100g: number, fatPer100g: number, carbsPer100g: number, grams: number,
): Portion {
  return {
    kcal: Math.round((tenths(kcalPer100g) * grams) / 1000),
    proteinG: Math.round((tenths(proteinPer100g) * grams) / 100) / 10,
    fatG: Math.round((tenths(fatPer100g) * grams) / 100) / 10,
    carbsG: Math.round((tenths(carbsPer100g) * grams) / 100) / 10,
  };
}

export interface Micros {
  fiberG: number | null;
  sugarsG: number | null;
  sodiumMg: number | null;
}

/**
 * Fibra y azúcares con un decimal y sodio en mg enteros de una cantidad (SPEC-nutrition-004, AC-04), con el mismo cálculo
 * por enteros que la API. Un valor sin dato (null) queda sin dato: no es cero.
 */
export function microsOf(
  fiberPer100g: number | null, sugarsPer100g: number | null, sodiumMgPer100g: number | null, grams: number,
): Micros {
  const decimal = (v: number | null) => (v === null ? null : Math.round((tenths(v) * grams) / 100) / 10);
  return {
    fiberG: decimal(fiberPer100g),
    sugarsG: decimal(sugarsPer100g),
    sodiumMg: sodiumMgPer100g === null ? null : Math.round((sodiumMgPer100g * grams) / 100),
  };
}

export interface MicroTotals {
  fiberG: number;
  sugarsG: number;
  sodiumMg: number;
  /** Alguna entrada no tenía esos datos: los totales no la cuentan (AC-05). */
  partial: boolean;
}

/** Suma de fibra, azúcares y sodio del día; lo que no tiene dato no suma y se marca como parcial. */
export function sumMicros(items: Micros[]): MicroTotals {
  const sum = (pick: (m: Micros) => number | null) => items.reduce((acc, m) => acc + tenths(pick(m) ?? 0), 0) / 10;
  return {
    fiberG: sum((m) => m.fiberG),
    sugarsG: sum((m) => m.sugarsG),
    sodiumMg: items.reduce((acc, m) => acc + (m.sodiumMg ?? 0), 0),
    partial: items.some((m) => m.fiberG === null || m.sugarsG === null || m.sodiumMg === null),
  };
}

export const MIN_WATER_ML = 1;
export const MAX_WATER_ML = 5000;
/** Meta de referencia, no un objetivo médico (P8). */
export const WATER_GOAL_ML = 2000;

export const MIN_OVERRIDE_CALORIES = 800;
export const MAX_OVERRIDE_CALORIES = 6000;

export interface Macros {
  proteinG: number;
  fatG: number;
  carbsG: number;
}

/**
 * Reparto de macros para unas calorías (SPEC-nutrition-002, AC-03): proteína por kilo según el objetivo, grasa al 25 % de las
 * calorías y carbohidratos lo que queda (nunca negativo). Copia de NutritionRules.MacrosFor de la API: la app la usa para
 * mostrar el ajuste sin conexión. Se calcula con enteros (centésimas de kilo y décimas de g/kg) para dar lo mismo que la API.
 */
export function macrosFor(calories: number, weightKg: number, goal: 'bajar_grasa' | 'ganar_musculo' | 'mantener'): Macros {
  const proteinPerKgTenths = goal === 'bajar_grasa' ? 20 : 18;
  const proteinG = Math.round((Math.round(weightKg * 100) * proteinPerKgTenths) / 1000);
  const fatG = Math.round(calories / 36); // 25 % de las calorías entre 9 kcal/g
  const carbsG = Math.max(0, Math.round((calories - proteinG * 4 - fatG * 9) / 4));
  return { proteinG, fatG, carbsG };
}

/** Suma de lo comido: las calorías enteras y los macros con un decimal, sin error de punto flotante. */
export function sumPortions(items: Portion[]): Portion {
  const sum = (pick: (p: Portion) => number) => items.reduce((acc, p) => acc + tenths(pick(p)), 0) / 10;
  return {
    kcal: items.reduce((acc, p) => acc + p.kcal, 0),
    proteinG: sum((p) => p.proteinG),
    fatG: sum((p) => p.fatG),
    carbsG: sum((p) => p.carbsG),
  };
}

/** Las comidas fijas se guardan siempre igual; las libres conservan lo escrito (como la API). */
export function normalizeMeal(text: string): string {
  const trimmed = text.trim();
  return FIXED_MEALS.find((m) => m === trimmed.toLowerCase()) ?? trimmed;
}

/** Orden de salida: las fijas, en su orden, y luego las libres por nombre. */
export function mealOrder(meal: string): number {
  const i = (FIXED_MEALS as readonly string[]).indexOf(meal);
  return i >= 0 ? i : FIXED_MEALS.length;
}

/** Texto sin mayúsculas ni acentos, para buscar alimentos. */
export const fold = (text: string): string =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
