import { describe, expect, it } from 'vitest';
import { FoodPhotoService, type EditedPhotoItem, type FoodPhotoItem } from './foodPhotoService';
import { MemoryStore } from './memoryStore';
import { NutritionService } from './nutritionService';
import type { NutritionApi } from './types';

const DATE = '2026-11-23';

// Sin conexión: toda llamada remota queda pendiente («retry»), así se prueba solo lo local.
const offline = new Proxy({}, { get: () => async () => 'retry' }) as unknown as NutritionApi;

const item = (over: Partial<FoodPhotoItem> = {}): FoodPhotoItem => ({
  name: 'Arroz blanco', grams: 150, confidence: 'media', estimate: true, kcalPer100g: 130, proteinPer100g: 2.7, fatPer100g: 0.3, carbsPer100g: 28,
  kcal: 195, proteinG: 4.1, fatG: 0.5, carbsG: 42, possibleAllergens: [], ...over,
});
const edited = (over: Partial<EditedPhotoItem> = {}, i = item()): EditedPhotoItem => ({ name: i.name, grams: String(i.grams), item: i, ...over });

function setup() {
  let n = 0;
  const store = new MemoryStore();
  const nutrition = new NutritionService(store, offline, () => `id-${++n}`, () => DATE);
  const camera = { capture: async () => ({ kind: 'cancelled' as const }) };
  return { store, service: new FoodPhotoService(camera, { analyzeFoodPhoto: async () => ({ kind: 'offline' }) }, nutrition) };
}

describe('FoodPhotoService (SPEC-ai-003)', () => {
  it('AC-ai-003-05 y 06: registra con el nombre y los gramos corregidos y crea un alimento con origen «ia»', async () => {
    const { store, service } = setup();

    const result = await service.register([edited({ name: 'Arroz integral', grams: '200' })], 'cena', DATE);

    expect(result).toEqual({ ok: true, registered: 1 });
    const [food] = await store.getFoods();
    expect(food).toMatchObject({ name: 'Arroz integral', source: 'ia', kcalPer100g: 130 });
    const [entry] = await store.getFoodEntries(DATE);
    expect(entry).toMatchObject({ meal: 'cena', grams: 200, kcal: 260 });
  });

  it('AC-ai-003-06: reutiliza el alimento «ia» idéntico en lugar de duplicarlo', async () => {
    const { store, service } = setup();

    await service.register([edited()], 'almuerzo', DATE);
    await service.register([edited()], 'cena', DATE);

    expect(await store.getFoods()).toHaveLength(1);
    expect(await store.getFoodEntries(DATE)).toHaveLength(2);
  });

  it('AC-ai-003-06: todo o nada: con un gramaje inválido no se registra ninguno', async () => {
    const { store, service } = setup();

    const result = await service.register([edited(), edited({ name: 'Pollo', grams: '0' }, item({ name: 'Pollo' }))], 'cena', DATE);

    expect(result.ok).toBe(false);
    expect(await store.getFoodEntries(DATE)).toEqual([]);
  });

  it('AC-ai-003-05: sin elementos no hay nada que registrar', async () => {
    const { service } = setup();

    expect(await service.register([], 'cena', DATE)).toEqual({ ok: false, issues: ['No hay nada que registrar.'] });
  });
});
