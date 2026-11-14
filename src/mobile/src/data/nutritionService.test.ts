import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './memoryStore';
import { NutritionService, parseFood, type RawFoodInput } from './nutritionService';
import { portionOf } from './nutritionRules';
import type {
  NutritionApi, NutritionTarget, PutLogResult, ServerFood, ServerFoodEntry, TargetsResponse,
} from './types';

const TODAY = '2026-11-13';

const TARGET: NutritionTarget = {
  calories: 2500, proteinG: 145, fatG: 69, carbsG: 321, basalKcal: 1800, weightKg: 80.5, weightDate: '2026-11-12',
};

interface Fake extends NutritionApi {
  online: boolean;
  calls: string[];
  foods: Map<string, ServerFood>;
  entries: Map<string, ServerFoodEntry>;
  targets: TargetsResponse;
  foodResult: PutLogResult | null;
  entryResult: PutLogResult | null;
}

function fakeRemote(): Fake {
  const r: Fake = {
    online: true,
    calls: [],
    foods: new Map(),
    entries: new Map(),
    targets: { kind: 'ok', target: TARGET },
    foodResult: null,
    entryResult: null,
    fetchTargets: async () => (r.online ? r.targets : null),
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
      const food = r.foods.get(entry.foodId ?? '');
      if (!food) return { kind: 'rejected', reason: 'El alimento no existe en tu lista.' };
      r.entries.set(entry.id, {
        ...entry, name: food.name, ...portionOf(food.kcalPer100g, food.proteinPer100g, food.fatPer100g, food.carbsPer100g, entry.grams),
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
      source: 'manual' as const, status: 'pending' as const, message: null, pendingOp: 'upsert' as const, attempted: false,
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

    expect(day.target).toEqual({ kind: 'target', target: TARGET, calculatedAt: TODAY });
  });

  it('AC-nutrition-001-15 sin conexión y sin ningún objetivo guardado no hay objetivo conocido', async () => {
    remote.online = false;

    expect((await service.loadDay(TODAY)).target).toEqual({ kind: 'unknown' });
  });

  it('AC-nutrition-001-15 con conexión trae del servidor las entradas y alimentos que el teléfono no tenía', async () => {
    remote.foods.set('f1', {
      id: 'f1', name: 'Huevo', brand: null, barcode: null, kcalPer100g: 143, proteinPer100g: 12.6, fatPer100g: 9.5, carbsPer100g: 0.7, source: 'manual',
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
