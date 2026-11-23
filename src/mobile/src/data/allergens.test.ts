import { describe, expect, it } from 'vitest';
import vectors from '../../../../tests/Api.Tests/Nutrition/allergen-vectors.json';
import { allergenConflicts, allergensFromOff, normalizeAllergens } from './allergens';

// Los mismos casos que ejecuta la API (AllergenVectorsTests): ADR-0004.

describe('vectores compartidos con la API (SPEC-nutrition-003)', () => {
  it.each(vectors.matches)('AC-nutrition-003-04 coincidencias: $name', (c) => {
    expect(allergenConflicts(c.profileAllergies, c.foodAllergens)).toEqual(c.expected);
  });

  it.each(vectors.off)('AC-nutrition-003-03 etiquetas de Open Food Facts: $name', (c) => {
    expect(allergensFromOff(c.offTags)).toEqual(c.expected);
  });
});

describe('normalizar etiquetas', () => {
  it('AC-nutrition-003-01 deja las válidas, sin repetir y en el orden del catálogo', () => {
    expect(normalizeAllergens(['leche', 'polen', 'gluten', 'leche'])).toEqual(['gluten', 'leche']);
    expect(normalizeAllergens(null)).toEqual([]);
  });
});
