import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './memoryStore';
import { NutritionService, parseFood, type RawFoodInput, type RawRecipeInput } from './nutritionService';
import { macrosFor, microsOf, portionOf, recipeTotal, scaleRecipe } from './nutritionRules';
import type {
  LocalProfile, NutritionApi, NutritionTarget, PutLogResult, ServerFood, ServerFoodEntry, ServerNutritionHistory, ServerRecipe, ServerWater, TargetsResponse,
} from './types';

const TODAY = '2026-11-13';

const TARGET: NutritionTarget = {
  calories: 2500, proteinG: 145, fatG: 69, carbsG: 321, basalKcal: 1800, weightKg: 80.5, weightDate: '2026-11-12',
  calculatedCalories: 2500, source: 'calculated',
};

const PROFILE: LocalProfile = {
  displayName: 'Julio', sex: 'masculino', birthDate: '1995-05-20', heightCm: 178, goal: 'mantener', activityLevel: 'ligero',
  experienceLevel: null, daysPerWeek: null, methodology: 'heavy_duty_personalizado', allergies: [],
};

interface Fake extends NutritionApi {
  online: boolean;
  calls: string[];
  foods: Map<string, ServerFood>;
  entries: Map<string, ServerFoodEntry>;
  water: Map<string, ServerWater>;
  recipes: Map<string, ServerRecipe>;
  targets: TargetsResponse;
  foodResult: PutLogResult | null;
  entryResult: PutLogResult | null;
  recipeResult: PutLogResult | null;
  history: ServerNutritionHistory | null;
}

function fakeRemote(): Fake {
  const r: Fake = {
    online: true,
    calls: [],
    foods: new Map(),
    entries: new Map(),
    water: new Map(),
    recipes: new Map(),
    targets: { kind: 'ok', target: TARGET },
    foodResult: null,
    entryResult: null,
    recipeResult: null,
    history: null,
    fetchTargets: async () => (r.online ? r.targets : null),
    putTargetOverride: async (calories) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`putOverride:${calories}`);
      // El «servidor» responde con esas calorías y su reparto de macros.
      if (r.targets.kind === 'ok') {
        const t = r.targets.target;
        r.targets = { kind: 'ok', target: { ...t, calories, ...macrosFor(calories, t.weightKg, 'mantener'), source: 'manual' } };
      }
      return { kind: 'ok' };
    },
    deleteTargetOverride: async () => {
      if (!r.online) return 'retry';
      r.calls.push('deleteOverride');
      if (r.targets.kind === 'ok') {
        const t = r.targets.target;
        r.targets = { kind: 'ok', target: { ...t, calories: t.calculatedCalories, ...macrosFor(t.calculatedCalories, t.weightKg, 'mantener'), source: 'calculated' } };
      }
      return 'ok';
    },
    fetchNutritionHistory: async () => (r.online ? r.history : null),
    fetchRecipes: async () => (r.online ? [...r.recipes.values()].map((x) => structuredClone(x)) : null),
    putRecipe: async (recipe) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`putRecipe:${recipe.id}`);
      if (r.recipeResult) return r.recipeResult;
      r.recipes.set(recipe.id, structuredClone(recipe));
      return { kind: 'ok' };
    },
    deleteRecipe: async (id) => {
      if (!r.online) return 'retry';
      r.calls.push(`deleteRecipe:${id}`);
      r.recipes.delete(id);
      return 'ok';
    },
    fetchDayWater: async (date) => (r.online ? [...r.water.values()].filter((w) => w.date === date) : null),
    putWaterEntry: async (w) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`putWater:${w.id}`);
      r.water.set(w.id, w);
      return { kind: 'ok' };
    },
    deleteWaterEntry: async (id) => {
      if (!r.online) return 'retry';
      r.calls.push(`deleteWater:${id}`);
      r.water.delete(id);
      return 'ok';
    },
    fetchFoods: async () => (r.online ? [...r.foods.values()] : null),
    putFood: async (food) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`putFood:${food.id}`);
      if (r.foodResult) return r.foodResult;
      r.foods.set(food.id, food);
      return { kind: 'ok' };
    },
    deleteFood: async (id) => {
      if (!r.online) return 'retry';
      r.calls.push(`deleteFood:${id}`);
      r.foods.delete(id);
      return 'ok';
    },
    fetchDayEntries: async (date) => (r.online ? [...r.entries.values()].filter((e) => e.date === date) : null),
    putFoodEntry: async (entry) => {
      if (!r.online) return { kind: 'retry' };
      r.calls.push(`putEntry:${entry.id}`);
      if (r.entryResult) return r.entryResult;
      if (entry.recipeId) {
        const recipe = r.recipes.get(entry.recipeId);
        if (!recipe) return { kind: 'rejected', reason: 'La receta no existe en tu lista.' };
        const eaten = scaleRecipe(recipeTotal(recipe.ingredients), recipe.servings, entry.servings ?? 1);
        r.entries.set(entry.id, {
          ...entry, name: recipe.name, kcal: eaten.kcal, proteinG: eaten.proteinG, fatG: eaten.fatG, carbsG: eaten.carbsG,
          fiberG: eaten.fiberG, sugarsG: eaten.sugarsG, sodiumMg: eaten.sodiumMg,
        });
        return { kind: 'ok' };
      }
      const food = r.foods.get(entry.foodId ?? '');
      if (!food) return { kind: 'rejected', reason: 'El alimento no existe en tu lista.' };
      r.entries.set(entry.id, {
        ...entry, name: food.name, ...portionOf(food.kcalPer100g, food.proteinPer100g, food.fatPer100g, food.carbsPer100g, entry.grams),
        ...microsOf(food.fiberPer100g ?? null, food.sugarsPer100g ?? null, food.sodiumMgPer100g ?? null, entry.grams),
      });
      return { kind: 'ok' };
    },
    deleteFoodEntry: async (id) => {
      if (!r.online) return 'retry';
      r.calls.push(`deleteEntry:${id}`);
      r.entries.delete(id);
      return 'ok';
    },
  };
  return r;
}

const food = (over: Partial<RawFoodInput> = {}): RawFoodInput => ({
  name: 'Avena', brand: 'Marca', barcode: '', kcal: '389', protein: '16,9', fat: '6,9', carbs: '66,3', source: 'manual', ...over,
});

let store: MemoryStore;
let remote: Fake;
let service: NutritionService;

beforeEach(() => {
  let n = 0;
  store = new MemoryStore();
  remote = fakeRemote();
  service = new NutritionService(store, remote, () => `id-${++n}`, () => TODAY);
});

const saveFood = async (over: Partial<RawFoodInput> = {}) => {
  const result = await service.saveFood(food(over));
  if (!result.ok) throw new Error(`no se guardó: ${result.issues.map((i) => i.message).join(' ')}`);
  return result.food;
};

describe('alimento: validación (AC-nutrition-001-05 y 06)', () => {
  it('acepta la coma decimal y deja los opcionales en nulo', () => {
    const parsed = parseFood(food({ brand: '', barcode: '' }));

    expect(parsed).toMatchObject({
      ok: true, draft: { name: 'Avena', brand: null, barcode: null, kcalPer100g: 389, proteinPer100g: 16.9, fatPer100g: 6.9, carbsPer100g: 66.3 },
    });
  });

  it.each<[Partial<RawFoodInput>, string]>([
    [{ name: '  ' }, 'name'],
    [{ name: 'x'.repeat(81) }, 'name'],
    [{ brand: 'm'.repeat(61) }, 'brand'],
    [{ barcode: 'abc' }, 'barcode'],
    [{ barcode: '123' }, 'barcode'],
    [{ kcal: '901' }, 'kcal'],
    [{ kcal: '' }, 'kcal'],
    [{ kcal: '100,55' }, 'kcal'],
    [{ protein: '-1' }, 'protein'],
    [{ fat: '100,1' }, 'fat'],
    [{ carbs: 'mucho' }, 'carbs'],
    [{ protein: '50', fat: '40', carbs: '20' }, 'total'],
  ])('AC-nutrition-001-06 rechaza %j (campo %s) sin guardar nada', async (over, field) => {
    const result = await service.saveFood(food(over));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.field)).toContain(field);
    expect(await store.getFoods()).toEqual([]);
  });

  it('AC-nutrition-001-05 las proteínas, grasas y carbohidratos pueden sumar exactamente 100 g', () => {
    expect(parseFood(food({ protein: '50', fat: '30', carbs: '20' })).ok).toBe(true);
  });
});

describe('alimentos propios (AC-nutrition-001-16, 07, 08, 09)', () => {
  it('AC-nutrition-001-16 guarda primero en el teléfono con un id del dispositivo, lo envía y queda sincronizado', async () => {
    const created = await saveFood();

    expect(created).toMatchObject({ id: 'id-1', status: 'synced', pendingOp: null, attempted: true });
    expect(remote.calls).toEqual(['putFood:id-1']);
    expect(remote.foods.get('id-1')?.kcalPer100g).toBe(389);
  });

  it('AC-nutrition-001-18 sin conexión queda pendiente y al volver la red se envía una sola vez con el mismo id', async () => {
    remote.online = false;
    const created = await saveFood();
    expect(created).toMatchObject({ status: 'pending', pendingOp: 'upsert' });

    remote.online = true;
    await service.syncPending();
    await service.syncPending();

    expect(remote.calls).toEqual(['putFood:id-1']);
    expect((await store.getFood('id-1'))?.status).toBe('synced');
  });

  it('AC-nutrition-001-07 otro alimento con el mismo código de barras se bloquea y ofrece el existente', async () => {
    const first = await saveFood({ barcode: '3017624010701' });

    const clash = await service.saveFood(food({ name: 'Otro', barcode: '3017624010701' }));

    expect(clash).toMatchObject({ ok: false, duplicateOf: first.id });
    expect(await service.saveFood(food({ name: 'Avena integral', barcode: '3017624010701' }), first.id)).toMatchObject({ ok: true });
    expect((await service.findByBarcode('3017624010701'))?.name).toBe('Avena integral');
  });

  it('AC-nutrition-001-07 un rechazo de la API (409) queda visible con el motivo y no se reintenta solo', async () => {
    remote.foodResult = { kind: 'rejected', reason: 'Ya tienes un alimento con ese código de barras.' };

    const created = await saveFood({ barcode: '3017624010701' });
    await service.syncPending();

    expect(created).toMatchObject({ status: 'rejected', message: 'Ya tienes un alimento con ese código de barras.' });
    expect(remote.calls).toEqual(['putFood:id-1']);
  });

  it('AC-nutrition-001-08 busca por nombre o marca sin distinguir mayúsculas ni acentos y ordena por nombre', async () => {
    await saveFood({ name: 'Plátano', brand: '' });
    await saveFood({ name: 'Arroz blanco', brand: 'Marca A' });
    await saveFood({ name: 'Yogur natural', brand: '' });

    expect((await service.searchFoods()).map((f) => f.name)).toEqual(['Arroz blanco', 'Plátano', 'Yogur natural']);
    expect((await service.searchFoods('PLATANO')).map((f) => f.name)).toEqual(['Plátano']);
    expect((await service.searchFoods('marca')).map((f) => f.name)).toEqual(['Arroz blanco']);
  });

  it('AC-nutrition-001-09 borrar quita el alimento de la lista y envía DELETE; si nunca se envió, no envía nada', async () => {
    const sent = await saveFood({ name: 'Enviado' });
    // Un alimento que nunca se intentó enviar (un intento fallido ya cuenta: puede haber llegado).
    const unsent = {
      id: 'sin-enviar', name: 'Sin enviar', brand: null, barcode: null, kcalPer100g: 1, proteinPer100g: 0, fatPer100g: 0, carbsPer100g: 0,
      source: 'manual' as const, allergens: [], fiberPer100g: null, sugarsPer100g: null, sodiumMgPer100g: null, status: 'pending' as const, message: null, pendingOp: 'upsert' as const, attempted: false,
    };
    await store.saveFood(unsent);
    remote.calls.length = 0;

    await service.deleteFood(unsent.id);
    expect(remote.calls).toEqual([]);
    expect((await service.searchFoods()).map((f) => f.name)).toEqual(['Enviado']);

    await service.deleteFood(sent.id);

    expect(remote.calls).toEqual([`deleteFood:${sent.id}`]);
    expect(await service.searchFoods()).toEqual([]);
  });
});

describe('lo comido (AC-nutrition-001-10, 16, 18, 19)', () => {
  it('AC-nutrition-001-10 guarda la copia del nombre y de los valores de la cantidad con las mismas reglas de redondeo', async () => {
    const oats = await saveFood();

    const result = await service.saveEntry({ date: TODAY, meal: 'Desayuno', grams: '183', foodId: oats.id });

    const expected = portionOf(389, 16.9, 6.9, 66.3, 183);
    expect(result).toMatchObject({ ok: true, entry: { name: 'Avena', meal: 'desayuno', grams: 183, ...expected, status: 'synced' } });
    expect(remote.entries.get('id-2')).toMatchObject(expected);
  });

  it.each<[Partial<{ date: string; meal: string; grams: string }>, string]>([
    [{ grams: '0' }, 'grams'],
    [{ grams: '5001' }, 'grams'],
    [{ grams: '12,5' }, 'grams'],
    [{ grams: '' }, 'grams'],
    [{ meal: '   ' }, 'meal'],
    [{ meal: 'c'.repeat(31) }, 'meal'],
    [{ date: 'ayer' }, 'date'],
    [{ date: '2026-11-20' }, 'date'],
  ])('AC-nutrition-001-11 rechaza %j (campo %s) sin guardar nada', async (over, field) => {
    const oats = await saveFood();

    const result = await service.saveEntry({ date: TODAY, meal: 'cena', grams: '50', foodId: oats.id, ...over });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.field)).toContain(field);
    expect(await store.getFoodEntries(TODAY)).toEqual([]);
  });

  it('AC-nutrition-001-11 mañana se acepta por las zonas horarias y un alimento que no está en la lista se rechaza', async () => {
    const oats = await saveFood();

    expect((await service.saveEntry({ date: '2026-11-14', meal: 'cena', grams: '50', foodId: oats.id })).ok).toBe(true);
    const unknown = await service.saveEntry({ date: TODAY, meal: 'cena', grams: '50', foodId: 'no-existe' });
    expect(unknown.ok ? [] : unknown.issues.map((i) => i.field)).toContain('food');
  });

  it('AC-nutrition-001-19 cambiar los gramos reenvía con el mismo id y recalcula; borrar desaparece al instante', async () => {
    const oats = await saveFood();
    const saved = await service.saveEntry({ date: TODAY, meal: 'desayuno', grams: '50', foodId: oats.id });
    if (!saved.ok) throw new Error('no se guardó');

    await service.saveEntry({ date: TODAY, meal: 'desayuno', grams: '100', foodId: oats.id }, saved.entry.id);
    expect((await store.getFoodEntries(TODAY))).toHaveLength(1);
    expect((await store.getFoodEntry(saved.entry.id))).toMatchObject({ grams: 100, kcal: 389 });
    expect(remote.calls.filter((c) => c === `putEntry:${saved.entry.id}`)).toHaveLength(2);

    await service.deleteEntry(saved.entry.id);
    expect(remote.calls).toContain(`deleteEntry:${saved.entry.id}`);
    expect((await service.loadDay(TODAY)).meals).toEqual([]);
  });

  it('AC-nutrition-001-18 sin conexión registrar, editar y borrar funciona en local y todo se envía al volver la red', async () => {
    const oats = await saveFood();
    remote.online = false;

    const a = await service.saveEntry({ date: TODAY, meal: 'desayuno', grams: '50', foodId: oats.id });
    const b = await service.saveEntry({ date: TODAY, meal: 'cena', grams: '100', foodId: oats.id });
    if (!a.ok || !b.ok) throw new Error('no se guardó');
    await service.saveEntry({ date: TODAY, meal: 'desayuno', grams: '60', foodId: oats.id }, a.entry.id);
    await service.deleteEntry(b.entry.id);
    const day = await service.loadDay(TODAY);

    expect(day.meals.map((m) => m.name)).toEqual(['desayuno']);
    expect(day.totals).toEqual({ ...portionOf(389, 16.9, 6.9, 66.3, 60) });

    remote.online = true;
    await service.syncPending();
    expect([...remote.entries.keys()]).toEqual([a.entry.id]); // lo borrado antes de enviarse nunca llegó
    expect(remote.entries.get(a.entry.id)?.grams).toBe(60);
  });

  it('AC-nutrition-001-16 los borrados se envían antes que los alimentos nuevos y las entradas después de su alimento', async () => {
    remote.online = false;
    const oats = await saveFood();
    const e = await service.saveEntry({ date: TODAY, meal: 'desayuno', grams: '50', foodId: oats.id });
    if (!e.ok) throw new Error('no se guardó');
    remote.online = true;
    remote.calls.length = 0;

    await service.syncPending();

    expect(remote.calls).toEqual([`putFood:${oats.id}`, `putEntry:${e.entry.id}`]);
  });

  it('AC-nutrition-001-18 ante un fallo de red se detiene y no sigue insistiendo', async () => {
    const oats = await saveFood();
    remote.online = false;
    await service.saveEntry({ date: TODAY, meal: 'desayuno', grams: '50', foodId: oats.id });
    await service.saveEntry({ date: TODAY, meal: 'cena', grams: '50', foodId: oats.id });
    remote.online = true;
    let attempts = 0;
    const original = remote.putFoodEntry;
    remote.putFoodEntry = async (entry) => {
      attempts++;
      return attempts === 1 ? { kind: 'retry' } : original(entry);
    };

    await service.syncPending();

    expect(attempts).toBe(1);
  });
});

describe('el día y el objetivo (AC-nutrition-001-13, 15, 18)', () => {
  it('AC-nutrition-001-15 arma el día con las comidas fijas primero, los totales y lo que falta frente al objetivo', async () => {
    const oats = await saveFood();
    await service.saveEntry({ date: TODAY, meal: 'Merienda libre', grams: '60', foodId: oats.id });
    await service.saveEntry({ date: TODAY, meal: 'cena', grams: '120', foodId: oats.id });
    await service.saveEntry({ date: TODAY, meal: 'desayuno', grams: '50', foodId: oats.id });
    await service.saveEntry({ date: '2026-11-12', meal: 'desayuno', grams: '999', foodId: oats.id }); // otro día

    const day = await service.loadDay(TODAY);

    expect(day.meals.map((m) => m.name)).toEqual(['desayuno', 'cena', 'Merienda libre']);
    const kcal = portionOf(389, 16.9, 6.9, 66.3, 50).kcal + portionOf(389, 16.9, 6.9, 66.3, 120).kcal + portionOf(389, 16.9, 6.9, 66.3, 60).kcal;
    expect(day.totals.kcal).toBe(kcal);
    expect(day.target).toMatchObject({ kind: 'target', calculatedAt: TODAY });
    expect(day.remaining?.kcal).toBe(TARGET.calories - kcal);
  });

  it('AC-nutrition-001-15 si falta el perfil o el peso lo indica en lugar del objetivo', async () => {
    remote.targets = { kind: 'missing', what: 'peso' };

    const day = await service.loadDay(TODAY);

    expect(day.target).toEqual({ kind: 'missing', what: 'peso' });
    expect(day.remaining).toBeNull();

    remote.targets = { kind: 'ok', target: TARGET };
    expect((await service.loadDay(TODAY)).target.kind).toBe('target'); // un cambio posterior se refleja
  });

  it('AC-nutrition-001-18 sin conexión muestra el último objetivo recibido con su fecha de cálculo', async () => {
    await service.loadDay(TODAY);
    remote.online = false;

    const day = await service.loadDay(TODAY);

    expect(day.target).toEqual({ kind: 'target', target: TARGET, calculatedAt: TODAY, pending: false });
  });

  it('AC-nutrition-001-15 sin conexión y sin ningún objetivo guardado no hay objetivo conocido', async () => {
    remote.online = false;

    expect((await service.loadDay(TODAY)).target).toEqual({ kind: 'unknown' });
  });

  it('AC-nutrition-001-15 con conexión trae del servidor las entradas y alimentos que el teléfono no tenía', async () => {
    remote.foods.set('f1', {
      id: 'f1', name: 'Huevo', brand: null, barcode: null, kcalPer100g: 143, proteinPer100g: 12.6, fatPer100g: 9.5, carbsPer100g: 0.7, source: 'manual', allergens: [],
    });
    remote.entries.set('e1', { id: 'e1', date: TODAY, meal: 'cena', foodId: 'f1', grams: 120, name: 'Huevo', kcal: 172, proteinG: 15.1, fatG: 11.4, carbsG: 0.8 });

    const day = await service.loadDay(TODAY);

    expect(day.meals[0].entries[0]).toMatchObject({ id: 'e1', name: 'Huevo', kcal: 172, status: 'synced' });
    expect((await service.searchFoods()).map((f) => f.name)).toEqual(['Huevo']);
  });

  it('AC-nutrition-001-18 lo rechazado por la API no cuenta en los totales y se puede descartar', async () => {
    const oats = await saveFood();
    remote.entryResult = { kind: 'rejected', reason: 'La fecha no es válida.' };
    const saved = await service.saveEntry({ date: TODAY, meal: 'cena', grams: '50', foodId: oats.id });
    if (!saved.ok) throw new Error('no se guardó');

    const day = await service.loadDay(TODAY);

    expect(day.meals[0].entries[0]).toMatchObject({ status: 'rejected', message: 'La fecha no es válida.' });
    expect(day.totals.kcal).toBe(0);
    await service.discardEntry(saved.entry.id);
    remote.entryResult = null;
    expect((await service.loadDay(TODAY)).meals).toEqual([]);
  });
});

describe('objetivo ajustado a mano (SPEC-nutrition-002)', () => {
  const calories = async () => {
    const state = await service.getTargetState();
    if (state.kind !== 'target') throw new Error('sin objetivo');
    return state;
  };

  beforeEach(async () => {
    await store.saveProfile(PROFILE);
    await service.loadDay(TODAY); // con conexión: guarda el objetivo calculado recibido
  });

  it.each(['', 'abc', '799', '6001', '2000,5', '-2000'])(
    'AC-nutrition-002-09 rechaza «%s» sin guardar ni enviar nada', async (text) => {
      const result = await service.setOverride(text);

      expect(result.ok).toBe(false);
      expect(remote.calls.filter((c) => c.includes('verride'))).toEqual([]);
      expect((await calories()).target.calories).toBe(2500);
    },
  );

  it('AC-nutrition-002-09 con conexión fija las calorías, las envía y muestra «manual» con los macros de la API', async () => {
    const result = await service.setOverride(' 2000 ');
    await service.loadDay(TODAY);

    expect(result).toEqual({ ok: true });
    expect(remote.calls).toContain('putOverride:2000');
    const state = await calories();
    expect(state.pending).toBe(false);
    expect(state.target).toMatchObject({ calories: 2000, source: 'manual', calculatedCalories: 2500, ...macrosFor(2000, 80.5, 'mantener') });
  });

  it('AC-nutrition-002-10 sin conexión se aplica al instante en el teléfono, con macros recalculados, y queda pendiente', async () => {
    remote.online = false;

    await service.setOverride('2000');

    const state = await calories();
    expect(state.pending).toBe(true);
    expect(state.target).toMatchObject({ calories: 2000, proteinG: 145, fatG: 56, carbsG: 229, source: 'manual' }); // vector: mantener, 80,5 kg
    expect(remote.calls).toEqual([]);
  });

  it('AC-nutrition-002-10 al volver la conexión se envía una sola vez y deja de estar pendiente', async () => {
    remote.online = false;
    await service.setOverride('2000');
    remote.online = true;

    await service.loadDay(TODAY);
    await service.loadDay(TODAY);

    expect(remote.calls.filter((c) => c.startsWith('putOverride'))).toEqual(['putOverride:2000']);
    expect((await calories()).pending).toBe(false);
  });

  it('AC-nutrition-002-10 mientras haya un ajuste pendiente una respuesta de la API no lo pisa', async () => {
    remote.online = false;
    await service.setOverride('2000');
    remote.online = true;
    remote.targets = { kind: 'ok', target: { ...TARGET, calories: 2600, calculatedCalories: 2600 } };
    await service.refreshTarget();

    expect((await calories()).target.calories).toBe(2000); // el pendiente manda hasta que se envía
  });

  it('AC-nutrition-002-10 dos ajustes sin conexión: solo el último se envía', async () => {
    remote.online = false;
    await service.setOverride('2000');
    await service.setOverride('2200');
    remote.online = true;

    await service.syncPending();

    expect(remote.calls.filter((c) => c.startsWith('putOverride'))).toEqual(['putOverride:2200']);
  });

  it('AC-nutrition-002-09 volver al calculado sin conexión muestra las calorías calculadas y envía el borrado al reconectar', async () => {
    await service.setOverride('2000');
    remote.online = false;

    await service.clearOverride();

    const state = await calories();
    expect(state.pending).toBe(true);
    expect(state.target).toMatchObject({ calories: 2500, source: 'calculated', ...macrosFor(2500, 80.5, 'mantener') });
    remote.online = true;
    await service.syncPending();
    expect(remote.calls).toContain('deleteOverride');
    expect((await calories()).pending).toBe(false);
  });

  it('AC-nutrition-002-09 sin objetivo calculado todavía no se puede ajustar', async () => {
    const empty = new NutritionService(new MemoryStore(), remote, () => 'x', () => TODAY);

    const result = await empty.setOverride('2000');

    expect(result.ok).toBe(false);
  });
});

describe('alérgenos (SPEC-nutrition-003)', () => {
  const MILK_ALLERGY: LocalProfile = { ...PROFILE, allergies: ['Intolerancia a la lactosa'] };

  it('AC-nutrition-003-01 guarda las etiquetas ordenadas y sin repetir, y las envía a la API', async () => {
    const saved = await saveFood({ allergens: ['leche', 'gluten', 'leche', 'polen'] });

    expect(saved.allergens).toEqual(['gluten', 'leche']);
    expect(remote.foods.get(saved.id)?.allergens).toEqual(['gluten', 'leche']);
  });

  it('AC-nutrition-003-01 sin etiquetas el alimento queda «sin dato» (vacío), no «sin alérgenos»', async () => {
    expect((await saveFood()).allergens).toEqual([]);
  });

  it('AC-nutrition-003-07 sin conexión los conflictos se calculan en el teléfono con el perfil local', async () => {
    await store.saveProfile(MILK_ALLERGY);
    const milky = await saveFood({ name: 'Yogur', allergens: ['leche'] });
    const plain = await saveFood({ name: 'Arroz' });
    remote.online = false;

    expect(await service.foodConflicts(milky)).toEqual(['leche']);
    expect(await service.foodConflicts(plain)).toEqual([]);
  });

  it('AC-nutrition-003-06 el día marca las entradas cuyo alimento choca con las alergias', async () => {
    await store.saveProfile(MILK_ALLERGY);
    const milky = await saveFood({ name: 'Yogur', allergens: ['leche'] });
    const plain = await saveFood({ name: 'Arroz' });
    const a = await service.saveEntry({ date: TODAY, meal: 'cena', grams: '100', foodId: milky.id });
    const b = await service.saveEntry({ date: TODAY, meal: 'cena', grams: '100', foodId: plain.id });
    if (!a.ok || !b.ok) throw new Error('no se guardó');

    const day = await service.loadDay(TODAY);

    expect(day.conflicts).toEqual({ [a.entry.id]: ['leche'] });
  });

  it('AC-nutrition-003-06 sin alergias en el perfil no se marca nada', async () => {
    const milky = await saveFood({ name: 'Yogur', allergens: ['leche'] });
    await service.saveEntry({ date: TODAY, meal: 'cena', grams: '100', foodId: milky.id });

    expect((await service.loadDay(TODAY)).conflicts).toEqual({});
  });

  it('AC-nutrition-003-01 al traer alimentos de un servidor sin el campo los deja sin dato', async () => {
    remote.foods.set('f1', {
      id: 'f1', name: 'Huevo', brand: null, barcode: null, kcalPer100g: 143, proteinPer100g: 12.6, fatPer100g: 9.5, carbsPer100g: 0.7,
      source: 'manual',
    } as unknown as ServerFood);

    await service.loadDay(TODAY);

    expect((await service.searchFoods()).map((f) => f.allergens)).toEqual([[]]);
  });
});

describe('micronutrientes (SPEC-nutrition-004)', () => {
  it.each<[Partial<RawFoodInput>, string]>([
    [{ fiber: '-1' }, 'fiber'],
    [{ fiber: '101' }, 'fiber'],
    [{ fiber: '1,25' }, 'fiber'],
    [{ sugars: 'mucho' }, 'sugars'],
    [{ sugars: '70' }, 'sugars'], // el alimento de prueba lleva 66,3 g de carbohidratos
    [{ sodium: '40001' }, 'sodium'],
    [{ sodium: '12,5' }, 'sodium'],
  ])('AC-nutrition-004-02 rechaza %j (campo %s) sin guardar nada', async (over, field) => {
    const result = await service.saveFood(food(over));

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.field)).toContain(field);
    expect(await store.getFoods()).toEqual([]);
  });

  it('AC-nutrition-004-01 los micronutrientes son opcionales: vacío es «sin dato», no cero', async () => {
    const plain = await saveFood();
    const full = await saveFood({ name: 'Galletas', fiber: '3,5', sugars: '12', sodium: '400' });

    expect([plain.fiberPer100g, plain.sugarsPer100g, plain.sodiumMgPer100g]).toEqual([null, null, null]);
    expect([full.fiberPer100g, full.sugarsPer100g, full.sodiumMgPer100g]).toEqual([3.5, 12, 400]);
    expect(remote.foods.get(full.id)).toMatchObject({ fiberPer100g: 3.5, sugarsPer100g: 12, sodiumMgPer100g: 400 });
  });

  it('AC-nutrition-004-03 y 05 la entrada copia los micronutrientes de esa cantidad y el día los suma avisando de lo parcial', async () => {
    const galletas = await saveFood({ name: 'Galletas', fiber: '6,7', sugars: '1,2', sodium: '1250' });
    const arroz = await saveFood({ name: 'Arroz' });
    const a = await service.saveEntry({ date: TODAY, meal: 'cena', grams: '50', foodId: galletas.id });
    if (!a.ok) throw new Error('no se guardó');
    expect(a.entry).toMatchObject({ fiberG: 3.4, sugarsG: 0.6, sodiumMg: 625 });

    expect((await service.loadDay(TODAY)).micros).toEqual({ fiberG: 3.4, sugarsG: 0.6, sodiumMg: 625, partial: false });
    await service.saveEntry({ date: TODAY, meal: 'cena', grams: '100', foodId: arroz.id });

    expect((await service.loadDay(TODAY)).micros).toEqual({ fiberG: 3.4, sugarsG: 0.6, sodiumMg: 625, partial: true });
  });
});

describe('agua (SPEC-nutrition-004)', () => {
  it('AC-nutrition-004-06 y 10 guarda primero en el teléfono con un id del dispositivo, lo envía y suma en el día', async () => {
    const result = await service.addWater(250);
    await service.addWater(500);

    expect(result.ok && result.water).toMatchObject({ id: 'id-1', ml: 250, date: TODAY, status: 'synced' });
    expect(remote.water.size).toBe(2);
    const day = await service.loadDay(TODAY);
    expect(day.waterMl).toBe(750);
    expect(day.water.map((w) => w.ml)).toEqual([250, 500]);
  });

  it('AC-nutrition-004-07 rechaza mililitros fuera de rango sin guardar nada', async () => {
    for (const ml of [0, 5001, 2.5, -10]) expect((await service.addWater(ml)).ok).toBe(false);

    expect(await store.getWater(TODAY)).toEqual([]);
  });

  it('AC-nutrition-004-10 sin conexión suma al instante, queda pendiente y se envía una sola vez al volver la conexión', async () => {
    remote.online = false;
    await service.addWater(250);

    expect((await service.loadDay(TODAY)).waterMl).toBe(250);
    expect(remote.calls).toEqual([]);

    remote.online = true;
    await service.loadDay(TODAY);
    await service.loadDay(TODAY);

    expect(remote.calls.filter((c) => c.startsWith('putWater'))).toEqual(['putWater:id-1']);
    expect((await store.getWater(TODAY))[0]).toMatchObject({ status: 'synced', pendingOp: null });
  });

  it('AC-nutrition-004-09 deshacer quita el agua del total al instante y el borrado llega a la API', async () => {
    remote.online = false;
    const unsent = await service.addWater(250);
    if (!unsent.ok) throw new Error('no se guardó');
    await service.removeWater(unsent.water.id);
    expect((await service.loadDay(TODAY)).waterMl).toBe(0);

    remote.online = true;
    const sent = await service.addWater(500);
    if (!sent.ok) throw new Error('no se guardó');
    await service.removeWater(sent.water.id);

    expect((await service.loadDay(TODAY)).waterMl).toBe(0);
    // El primero se intentó enviar sin conexión (puede haber llegado): se borra en la API al volver la conexión.
    expect(remote.calls).toEqual([`deleteWater:${unsent.water.id}`, `putWater:${sent.water.id}`, `deleteWater:${sent.water.id}`]);
    expect(remote.water.size).toBe(0);
  });

  it('AC-nutrition-004-09 con conexión trae del servidor el agua que el teléfono no tenía', async () => {
    remote.water.set('w1', { id: 'w1', date: TODAY, ml: 300 });

    expect((await service.loadDay(TODAY)).waterMl).toBe(300);
  });
});

describe('recetas (SPEC-nutrition-005)', () => {
  const recipeInput = (foodId: string, over: Partial<RawRecipeInput> = {}): RawRecipeInput => ({
    name: 'Gachas', servings: '2', ingredients: [{ foodId, grams: '200' }], ...over,
  });
  const saveRecipe = async (input: RawRecipeInput, id?: string) => {
    const result = await service.saveRecipe(input, id);
    if (!result.ok) throw new Error(`no se guardó: ${result.issues.map((i) => i.message).join(' ')}`);
    return result.recipe;
  };

  it('AC-nutrition-005-01 guarda primero en el teléfono con un id del dispositivo, copia los valores del alimento y lo envía', async () => {
    const oats = await saveFood();

    const recipe = await saveRecipe(recipeInput(oats.id));

    expect(recipe).toMatchObject({ name: 'Gachas', servings: 2, status: 'synced', pendingOp: null });
    expect(recipe.ingredients).toEqual([expect.objectContaining({ foodId: oats.id, name: 'Avena', grams: 200, kcalPer100g: 389 })]);
    expect(remote.recipes.get(recipe.id)?.ingredients[0].grams).toBe(200);
  });

  it.each<[Partial<RawRecipeInput>, string]>([
    [{ name: ' ' }, 'name'],
    [{ name: 'x'.repeat(81) }, 'name'],
    [{ servings: '0' }, 'servings'],
    [{ servings: '51' }, 'servings'],
    [{ servings: '1,5' }, 'servings'],
    [{ ingredients: [] }, 'ingredients'],
    [{ ingredients: [{ foodId: 'f', grams: '0' }] }, 'grams'],
    [{ ingredients: [{ foodId: 'f', grams: '5001' }] }, 'grams'],
    [{ ingredients: [{ foodId: 'inexistente', grams: '10' }] }, 'food'],
  ])('AC-nutrition-005-02 rechaza %j (campo %s) sin guardar nada', async (over, field) => {
    const oats = await saveFood();
    const input = recipeInput(oats.id, over);
    if (over.ingredients?.[0]?.foodId === 'f') input.ingredients = [{ foodId: oats.id, grams: over.ingredients[0].grams }];

    const result = await service.saveRecipe(input);

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues.map((i) => i.field)).toContain(field);
    expect(await store.getRecipes()).toEqual([]);
  });

  it('AC-nutrition-005-02 un alimento no puede repetirse en la receta', async () => {
    const oats = await saveFood();

    const result = await service.saveRecipe(recipeInput(oats.id, { ingredients: [{ foodId: oats.id, grams: '50' }, { foodId: oats.id, grams: '60' }] }));

    expect(result.ok).toBe(false);
  });

  it('AC-nutrition-005-04 registrar raciones copia los valores de esa cantidad y se envía con la receta primero', async () => {
    const oats = await saveFood();
    const recipe = await saveRecipe(recipeInput(oats.id)); // 778 kcal, 2 raciones

    const saved = await service.saveRecipeEntry({ date: TODAY, meal: 'desayuno', servings: '1,5', recipeId: recipe.id });

    if (!saved.ok) throw new Error('no se guardó');
    expect(saved.entry).toMatchObject({ name: 'Gachas', foodId: null, grams: 0, recipeId: recipe.id, servings: 1.5, kcal: 584, status: 'synced' });
    expect(remote.entries.get(saved.entry.id)).toMatchObject({ kcal: 584, recipeId: recipe.id, servings: 1.5 });
    expect((await service.loadDay(TODAY)).totals.kcal).toBe(584);
  });

  it.each(['0,2', '21', '1,234', 'abc', ''])('AC-nutrition-005-04 rechaza las raciones «%s»', async (servings) => {
    const oats = await saveFood();
    const recipe = await saveRecipe(recipeInput(oats.id));

    const result = await service.saveRecipeEntry({ date: TODAY, meal: 'cena', servings, recipeId: recipe.id });

    expect(result.ok).toBe(false);
    expect(await store.getFoodEntries(TODAY)).toEqual([]);
  });

  it('AC-nutrition-005-04 cambiar o borrar la receta no reescribe lo ya comido', async () => {
    const oats = await saveFood();
    const recipe = await saveRecipe(recipeInput(oats.id));
    const saved = await service.saveRecipeEntry({ date: TODAY, meal: 'cena', servings: '1', recipeId: recipe.id });
    if (!saved.ok) throw new Error('no se guardó');

    await saveRecipe(recipeInput(oats.id, { name: 'Gachas ligeras', ingredients: [{ foodId: oats.id, grams: '20' }] }), recipe.id);
    await service.deleteRecipe(recipe.id);

    const [entry] = await store.getFoodEntries(TODAY);
    expect(entry).toMatchObject({ name: 'Gachas', kcal: 389, recipeId: recipe.id });
    expect(await service.listRecipes()).toEqual([]);
  });

  it('AC-nutrition-005-09 sin conexión crea y registra en el teléfono y al volver la conexión envía la receta antes que la entrada', async () => {
    const oats = await saveFood();
    remote.online = false;
    const recipe = await saveRecipe(recipeInput(oats.id));
    const saved = await service.saveRecipeEntry({ date: TODAY, meal: 'cena', servings: '1', recipeId: recipe.id });
    if (!saved.ok) throw new Error('no se guardó');

    expect((await service.loadDay(TODAY)).totals.kcal).toBe(389);
    remote.online = true;
    remote.calls.length = 0;
    await service.syncPending();

    expect(remote.calls).toEqual([`putRecipe:${recipe.id}`, `putEntry:${saved.entry.id}`]);
    expect((await store.getRecipe(recipe.id))?.status).toBe('synced');
  });

  it('AC-nutrition-005-09 con conexión trae del servidor las recetas que el teléfono no tenía', async () => {
    remote.recipes.set('r1', {
      id: 'r1', name: 'Tortilla', servings: 2,
      ingredients: [{ foodId: null, name: 'Huevo', grams: 120, kcalPer100g: 143, proteinPer100g: 12.6, fatPer100g: 9.5, carbsPer100g: 0.7, fiberPer100g: 0, sugarsPer100g: 0.4, sodiumMgPer100g: 142 }],
    });

    await service.loadDay(TODAY);

    expect((await service.listRecipes()).map((r) => r.name)).toEqual(['Tortilla']);
  });

  it('AC-nutrition-005-02 una receta rechazada por la API se muestra rechazada y se puede descartar', async () => {
    const oats = await saveFood();
    remote.recipeResult = { kind: 'rejected', reason: 'Algún ingrediente no existe en tu lista de alimentos.' };

    const recipe = await saveRecipe(recipeInput(oats.id));

    expect(recipe.status).toBe('rejected');
    await service.discardRecipe(recipe.id);
    expect(await service.listRecipes()).toEqual([]);
  });
});

describe('historial de nutrición (SPEC-nutrition-006)', () => {
  // TODAY = jueves 2026-11-13; la semana ISO empieza el lunes 2026-11-09 y la anterior el 2026-11-02.
  const day = (date: string, kcal: number, logged = true) => ({ date, logged, kcal, proteinG: kcal / 20, fatG: kcal / 40, carbsG: kcal / 10 });

  it('AC-nutrition-006-08 con conexión usa el historial de la API, con el objetivo de hoy, y los días sin registro no cuentan', async () => {
    remote.history = {
      days: [day('2026-11-02', 2000), day('2026-11-03', 2200), day('2026-11-04', 0, false), day('2026-11-09', 1000)],
      targets: { ...TARGET, calories: 2000 },
    };

    const view = await service.loadHistory(4);

    expect(view.offline).toBe(false);
    expect(view.targetKcal).toBe(2000);
    expect(view.weeks.map((w) => [w.weekStart, w.daysLogged, w.avgKcal, w.daysOnTarget])).toEqual([
      ['2026-11-02', 2, 2100, 2],
      ['2026-11-09', 1, 1000, 0],
    ]);
  });

  it('AC-nutrition-006-09 sin conexión usa el último historial recibido', async () => {
    remote.history = { days: [day('2026-11-09', 1800)], targets: { ...TARGET, calories: 2000 } };
    await service.loadHistory(4);
    remote.online = false;

    const view = await service.loadHistory(4);

    expect(view.offline).toBe(true);
    expect(view.weeks).toMatchObject([{ weekStart: '2026-11-09', avgKcal: 1800 }]);
    expect(view.targetKcal).toBe(2000);
  });

  it('AC-nutrition-006-09 lo que hay en el teléfono manda sobre el historial: entradas pendientes y borradas', async () => {
    const oats = await saveFood(); // 389 kcal por 100 g
    remote.history = { days: [day('2026-11-09', 1800), day('2026-11-10', 2000)], targets: null };
    remote.online = false;
    const saved = await service.saveEntry({ date: '2026-11-09', meal: 'cena', grams: '100', foodId: oats.id });
    if (!saved.ok) throw new Error('no se guardó');
    // El 10 el teléfono tiene una entrada que se borró aquí (pendiente de enviar el borrado).
    await store.saveFoodEntry({
      ...saved.entry, id: 'borrada', date: '2026-11-10', status: 'pending', pendingOp: 'delete', attempted: true,
    });

    const view = await service.loadHistory(4);

    expect(view.days.map((d) => [d.date, d.kcal])).toEqual([['2026-11-09', 389]]);
  });

  it('AC-nutrition-006-06 sin objetivo conocido no hay adherencia', async () => {
    remote.history = { days: [day('2026-11-09', 1800)], targets: null };
    remote.targets = { kind: 'missing', what: 'peso' };

    const view = await service.loadHistory(4);

    expect(view.targetKcal).toBeNull();
    expect(view.weeks[0].daysOnTarget).toBeNull();
  });

  it('AC-nutrition-006-08 las semanas pedidas se limitan a 1–12', async () => {
    remote.history = { days: [day('2026-08-01', 2000)], targets: null };

    expect((await service.loadHistory(52)).weeks).toEqual([]); // 12 semanas: desde el lunes 2026-08-24
    expect((await service.loadHistory(0)).weeks).toEqual([]);
  });
});
