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

export const MIN_SERVINGS = 0.25;
export const MAX_SERVINGS = 20;
export const MAX_RECIPE_SERVINGS = 50;
export const MAX_INGREDIENTS = 40;

export interface IngredientValues {
  kcalPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  fiberPer100g: number | null;
  sugarsPer100g: number | null;
  sodiumMgPer100g: number | null;
  grams: number;
}

/** Calorías y macros de una receta o de unas raciones; fibra, azúcares y sodio null = sin dato. */
export interface RecipeValues {
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  fiberG: number | null;
  sugarsG: number | null;
  sodiumMg: number | null;
}

/**
 * Suma de los ingredientes, cada uno redondeado como una entrada (SPEC-nutrition-005, AC-03; copia de NutritionRules.RecipeTotal).
 * Si algún ingrediente no tiene fibra, azúcares o sodio, ese total queda sin dato.
 */
export function recipeTotal(ingredients: IngredientValues[]): RecipeValues {
  const parts = ingredients.map((i) => ({
    p: portionOf(i.kcalPer100g, i.proteinPer100g, i.fatPer100g, i.carbsPer100g, i.grams),
    m: microsOf(i.fiberPer100g, i.sugarsPer100g, i.sodiumMgPer100g, i.grams),
  }));
  const sumTenths = (pick: (x: (typeof parts)[number]) => number) => parts.reduce((acc, x) => acc + tenths(pick(x)), 0) / 10;
  const sumOptional = (pick: (x: (typeof parts)[number]) => number | null): number | null =>
    parts.some((x) => pick(x) === null) ? null : sumTenths((x) => pick(x) ?? 0);
  return {
    kcal: parts.reduce((acc, x) => acc + x.p.kcal, 0),
    proteinG: sumTenths((x) => x.p.proteinG),
    fatG: sumTenths((x) => x.p.fatG),
    carbsG: sumTenths((x) => x.p.carbsG),
    fiberG: sumOptional((x) => x.m.fiberG),
    sugarsG: sumOptional((x) => x.m.sugarsG),
    sodiumMg: parts.some((x) => x.m.sodiumMg === null) ? null : parts.reduce((acc, x) => acc + (x.m.sodiumMg ?? 0), 0),
  };
}

/**
 * Valores de unas raciones de una receta de `recipeServings` raciones: total × comidas / raciones (copia de ScaleRecipe). Se calcula
 * con enteros (centésimas de ración y décimas de gramo) para dar exactamente lo mismo que la API; con 1 ración, el valor por ración.
 */
export function scaleRecipe(total: RecipeValues, recipeServings: number, servings: number): RecipeValues {
  const hundredths = Math.round(servings * 100);
  const divisor = 100 * recipeServings;
  const oneDecimal = (v: number | null): number | null => (v === null ? null : Math.round((tenths(v) * hundredths) / divisor) / 10);
  return {
    kcal: Math.round((total.kcal * hundredths) / divisor),
    proteinG: oneDecimal(total.proteinG) as number,
    fatG: oneDecimal(total.fatG) as number,
    carbsG: oneDecimal(total.carbsG) as number,
    fiberG: oneDecimal(total.fiberG),
    sugarsG: oneDecimal(total.sugarsG),
    sodiumMg: total.sodiumMg === null ? null : Math.round((total.sodiumMg * hundredths) / divisor),
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
