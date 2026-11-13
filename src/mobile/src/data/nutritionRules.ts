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
