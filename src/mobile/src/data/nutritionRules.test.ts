import { describe, expect, it } from 'vitest';
import vectors from '../../../../tests/Api.Tests/Nutrition/nutrition-vectors.json';
import { fold, mealOrder, normalizeMeal, portionOf, sumPortions } from './nutritionRules';

// Los mismos casos que ejecuta la API (NutritionTests.cs): ADR-0004. El objetivo diario solo lo calcula la API.

describe('vectores compartidos con la API (SPEC-nutrition-001)', () => {
  it.each(vectors.portions)('AC-nutrition-001-02 redondeo por cantidad: $name', (c) => {
    const p = portionOf(c.kcalPer100g, c.proteinPer100g, c.fatPer100g, c.carbsPer100g, c.grams);

    expect(p).toEqual(c.expected);
  });
});

describe('reglas de lo comido', () => {
  it('AC-nutrition-001-18 los totales suman calorías enteras y macros con un decimal, sin error de punto flotante', () => {
    const items = [
      { kcal: 195, proteinG: 8.5, fatG: 3.5, carbsG: 33.2 },
      { kcal: 172, proteinG: 15.1, fatG: 11.4, carbsG: 0.8 },
      { kcal: 10, proteinG: 0.1, fatG: 0.2, carbsG: 0.7 },
    ];

    expect(sumPortions(items)).toEqual({ kcal: 377, proteinG: 23.7, fatG: 15.1, carbsG: 34.7 });
    expect(sumPortions([])).toEqual({ kcal: 0, proteinG: 0, fatG: 0, carbsG: 0 });
  });

  it.each([
    ['Desayuno', 'desayuno'], ['  CENA ', 'cena'], ['Snack', 'snack'], ['Merienda de la tarde', 'Merienda de la tarde'],
  ])('AC-nutrition-001-10 la comida «%s» se guarda como «%s»', (typed, saved) => {
    expect(normalizeMeal(typed)).toBe(saved);
  });

  it('AC-nutrition-001-13 las comidas fijas van primero, en su orden, y luego las libres', () => {
    const meals = ['merienda', 'cena', 'snack', 'desayuno', 'almuerzo'];

    expect(meals.sort((a, b) => mealOrder(a) - mealOrder(b) || a.localeCompare(b))).toEqual(
      ['desayuno', 'almuerzo', 'cena', 'snack', 'merienda'],
    );
  });

  it('AC-nutrition-001-08 la búsqueda no distingue mayúsculas ni acentos', () => {
    expect(fold('  PLÁTANO ')).toBe('platano');
    expect(fold('Yogur')).toBe('yogur');
  });
});
