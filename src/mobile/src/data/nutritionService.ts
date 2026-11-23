import { allergenConflicts, normalizeAllergens } from './allergens';
import { weeklyIntake, type DayIntake, type WeekIntake } from './nutritionHistory';
import { addDays as addDaysIso, mondayOf } from './weightStats';
import {
  fold, macrosFor, MAX_GRAMS, MAX_INGREDIENTS, MAX_OVERRIDE_CALORIES, MAX_RECIPE_SERVINGS, MAX_SERVINGS, MAX_WATER_ML, MEAL_MAX_LENGTH,
  microsOf, MIN_GRAMS, MIN_OVERRIDE_CALORIES, MIN_SERVINGS, MIN_WATER_ML, mealOrder, normalizeMeal, portionOf, recipeTotal, scaleRecipe,
  sumMicros, sumPortions, type MicroTotals, type Portion,
} from './nutritionRules';
import type {
  LocalFood, LocalFoodEntry, LocalIngredient, LocalRecipe, LocalStore, LocalWater, NutritionApi, NutritionTarget, ServerFood,
} from './types';

const TARGET_KEY = 'nutritionTarget';
const MISSING_KEY = 'nutritionMissing';
/** Cambio del objetivo que aún no llegó a la API (SPEC-nutrition-002): `{ op: 'put', calories }` o `{ op: 'delete' }`. */
const OVERRIDE_PENDING_KEY = 'nutritionOverridePending';
/** Último historial recibido de la API (SPEC-nutrition-006), para verlo sin conexión. */
const HISTORY_KEY = 'nutritionHistory';

type PendingOverride = { op: 'put'; calories: number } | { op: 'delete' };
const EARLIEST_DATE = '2000-01-01';

/** Lo que escribe la persona al crear un alimento, sin interpretar. */
export interface RawFoodInput {
  name: string;
  brand: string;
  barcode: string;
  kcal: string;
  protein: string;
  fat: string;
  carbs: string;
  source: 'manual' | 'openfoodfacts' | 'ia';
  /** Etiquetas de alérgenos elegidas (SPEC-nutrition-003); sin ellas el alimento queda «sin dato». */
  allergens?: string[];
  /** Opcionales (SPEC-nutrition-004): fibra y azúcares en g y sodio en mg, por 100 g. Vacío = sin dato. */
  fiber?: string;
  sugars?: string;
  sodium?: string;
}

export interface FoodIssue {
  field: 'name' | 'brand' | 'barcode' | 'kcal' | 'protein' | 'fat' | 'carbs' | 'total' | 'fiber' | 'sugars' | 'sodium';
  message: string;
}

export interface EntryIssue {
  field: 'date' | 'meal' | 'grams' | 'food';
  message: string;
}

/** Lo que escribe la persona al crear una receta, sin interpretar (SPEC-nutrition-005). */
export interface RawRecipeInput {
  name: string;
  servings: string;
  ingredients: { foodId: string; grams: string }[];
}

export interface RecipeIssue {
  field: 'name' | 'servings' | 'ingredients' | 'grams' | 'food';
  message: string;
}

export interface HistoryView {
  /** Semanas ISO con algún día registrado, de la más antigua a la más reciente. */
  weeks: WeekIntake[];
  /** Días con registro (los demás no cuentan en los promedios). */
  days: DayIntake[];
  /** Calorías del objetivo vigente (el de hoy para todo el rango); null si no se conoce. */
  targetKcal: number | null;
  /** El servidor no respondió: se usa el último historial recibido y lo que hay en el teléfono. */
  offline: boolean;
}

export const MAX_HISTORY_WEEKS = 12;

export type SaveRecipeResult = { ok: true; recipe: LocalRecipe } | { ok: false; issues: RecipeIssue[] };

export type SaveFoodResult =
  | { ok: true; food: LocalFood }
  | { ok: false; issues: FoodIssue[]; /** Alimento propio con el mismo código de barras, para usarlo en lugar de crear otro. */ duplicateOf?: string };

export type SaveEntryResult = { ok: true; entry: LocalFoodEntry } | { ok: false; issues: EntryIssue[] };

export interface MealGroup {
  name: string;
  entries: LocalFoodEntry[];
}

export type SetOverrideResult = { ok: true } | { ok: false; message: string };

/**
 * Objetivo que se muestra: el último recibido de la API (con su fecha), lo que falta, o nada sabido. `pending` indica que
 * hay un ajuste hecho en el teléfono que todavía no llegó a la API (SPEC-nutrition-002, AC-10).
 */
export type TargetState =
  | { kind: 'target'; target: NutritionTarget; calculatedAt: string; pending: boolean }
  | { kind: 'missing'; what: 'perfil' | 'peso' }
  | { kind: 'unknown' };

export interface DayView {
  date: string;
  meals: MealGroup[];
  totals: Portion;
  target: TargetState;
  /** Objetivo menos lo consumido; negativo si se pasó. Null sin objetivo. */
  remaining: Portion | null;
  /** Fibra, azúcares y sodio del día; lo que no tiene dato no suma (SPEC-nutrition-004, AC-05). */
  micros: MicroTotals;
  /** Agua del día (SPEC-nutrition-004). */
  water: LocalWater[];
  waterMl: number;
  /** Entradas cuyo alimento choca con las alergias del perfil: id de la entrada → alérgenos (SPEC-nutrition-003, AC-06). */
  conflicts: Record<string, string[]>;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Día local en formato AAAA-MM-DD. */
export function localDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function isRealDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

function addDays(text: string, days: number): string {
  const [y, mo, d] = text.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

/** Número con coma o punto decimal; vacío o texto no numérico es NaN. */
const decimal = (text: string): number => (text.trim() === '' ? Number.NaN : Number(text.trim().replace(',', '.')));

const oneDecimal = (n: number): boolean => Math.abs(Math.round(n * 10) - n * 10) < 1e-6;

/** Valida el formulario del alimento con las mismas reglas que la API (AC-nutrition-001-05 y 06). */
export function parseFood(raw: RawFoodInput): { ok: true; draft: Omit<LocalFood, 'id' | 'status' | 'message' | 'pendingOp' | 'attempted'> } | { ok: false; issues: FoodIssue[] } {
  const issues: FoodIssue[] = [];
  const name = raw.name.trim();
  if (name.length < 1 || name.length > 80) issues.push({ field: 'name', message: 'El nombre lleva entre 1 y 80 caracteres.' });
  const brand = raw.brand.trim();
  if (brand.length > 60) issues.push({ field: 'brand', message: 'La marca lleva como máximo 60 caracteres.' });
  const barcode = raw.barcode.trim();
  if (barcode !== '' && !/^\d{6,14}$/.test(barcode)) issues.push({ field: 'barcode', message: 'El código de barras son entre 6 y 14 cifras.' });

  const read = (field: FoodIssue['field'], text: string, max: number, label: string): number => {
    const n = decimal(text);
    if (!Number.isFinite(n) || n < 0 || n > max) {
      issues.push({ field, message: `${label} por 100 g va de 0 a ${max}${field === 'kcal' ? '' : ' g'}.` });
    } else if (!oneDecimal(n)) {
      issues.push({ field, message: 'Los valores admiten como máximo un decimal.' });
    }
    return n;
  };
  const kcal = read('kcal', raw.kcal, 900, 'Las calorías');
  const protein = read('protein', raw.protein, 100, 'La proteína');
  const fat = read('fat', raw.fat, 100, 'La grasa');
  const carbs = read('carbs', raw.carbs, 100, 'Los carbohidratos');
  if ([protein, fat, carbs].every(Number.isFinite) && Math.round((protein + fat + carbs) * 10) > 1000) {
    issues.push({ field: 'total', message: 'Proteína, grasa y carbohidratos no pueden sumar más de 100 g por 100 g.' });
  }

  // SPEC-nutrition-004, AC-01 y 02: opcionales; vacío = sin dato.
  const optional = (field: 'fiber' | 'sugars' | 'sodium', text: string | undefined, max: number, label: string, whole: boolean): number | null => {
    if ((text ?? '').trim() === '') return null;
    const n = decimal(text ?? '');
    if (!Number.isFinite(n) || n < 0 || n > max) {
      issues.push({ field, message: `${label} por 100 g va de 0 a ${max}${field === 'sodium' ? ' mg' : ' g'}.` });
    } else if (whole ? !Number.isInteger(n) : !oneDecimal(n)) {
      issues.push({ field, message: whole ? 'El sodio se escribe en mg, sin decimales.' : 'Los valores admiten como máximo un decimal.' });
    }
    return n;
  };
  const fiber = optional('fiber', raw.fiber, 100, 'La fibra', false);
  const sugars = optional('sugars', raw.sugars, 100, 'Los azúcares', false);
  const sodium = optional('sodium', raw.sodium, 40000, 'El sodio', true);
  if (sugars !== null && Number.isFinite(sugars) && Number.isFinite(carbs) && Math.round(sugars * 10) > Math.round(carbs * 10)) {
    issues.push({ field: 'sugars', message: 'Los azúcares no pueden superar los carbohidratos.' });
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    draft: {
      name, brand: brand || null, barcode: barcode || null, kcalPer100g: kcal, proteinPer100g: protein,
      fatPer100g: fat, carbsPer100g: carbs, source: raw.source, allergens: normalizeAllergens(raw.allergens),
      fiberPer100g: fiber, sugarsPer100g: sugars, sodiumMgPer100g: sodium,
    },
  };
}

const foodToServer = (f: LocalFood): ServerFood => ({
  id: f.id, name: f.name, brand: f.brand, barcode: f.barcode, kcalPer100g: f.kcalPer100g, proteinPer100g: f.proteinPer100g,
  fatPer100g: f.fatPer100g, carbsPer100g: f.carbsPer100g, source: f.source, allergens: f.allergens,
  fiberPer100g: f.fiberPer100g, sugarsPer100g: f.sugarsPer100g, sodiumMgPer100g: f.sodiumMgPer100g,
});

const isVisible = (x: { pendingOp: string | null }): boolean => x.pendingOp !== 'delete';

/**
 * Alimentos y lo comido con soporte sin conexión (SPEC-nutrition-001, P2). Todo cambio se guarda primero en el
 * teléfono con ids del dispositivo y se envía después; lo que no llega queda `pending` y se reintenta con los mismos ids.
 */
export class NutritionService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LocalStore,
    private readonly remote: NutritionApi,
    private readonly newId: () => string,
    private readonly today: () => string = () => localDate(),
  ) {}

  // ---------- alimentos ----------

  /** Alimentos propios que no esperan borrarse, por nombre, filtrados sin distinguir mayúsculas ni acentos (AC-08 de la app). */
  async searchFoods(query = ''): Promise<LocalFood[]> {
    const needle = fold(query);
    return (await this.store.getFoods())
      .filter(isVisible)
      .filter((f) => needle === '' || fold(f.name).includes(needle) || fold(f.brand ?? '').includes(needle))
      .sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
  }

  async findByBarcode(barcode: string): Promise<LocalFood | null> {
    return (await this.store.getFoods()).find((f) => isVisible(f) && f.barcode === barcode) ?? null;
  }

  /** AC-nutrition-001-16: crea el alimento, o reemplaza el que tiene `existingId`, y lo intenta enviar. */
  async saveFood(raw: RawFoodInput, existingId?: string): Promise<SaveFoodResult> {
    const parsed = parseFood(raw);
    if (!parsed.ok) return { ok: false, issues: parsed.issues };

    if (parsed.draft.barcode) {
      const clash = (await this.store.getFoods()).find((f) => isVisible(f) && f.barcode === parsed.draft.barcode && f.id !== existingId);
      if (clash) {
        return { ok: false, issues: [{ field: 'barcode', message: 'Ya tienes un alimento con ese código de barras.' }], duplicateOf: clash.id };
      }
    }

    const existing = existingId ? await this.store.getFood(existingId) : null;
    const food: LocalFood = {
      ...parsed.draft, id: existingId ?? this.newId(), status: 'pending', message: null, pendingOp: 'upsert', attempted: existing?.attempted ?? false,
    };
    await this.store.saveFood(food);
    await this.syncPending();
    return { ok: true, food: (await this.store.getFood(food.id)) ?? food };
  }

  /** Quita el alimento de la lista; lo ya comido conserva sus valores (AC-nutrition-001-09). */
  async deleteFood(id: string): Promise<void> {
    const row = await this.store.getFood(id);
    if (!row) return;
    if (!row.attempted) {
      await this.store.deleteFood(id);
      return;
    }
    await this.store.saveFood({ ...row, status: 'pending', message: null, pendingOp: 'delete' });
    await this.syncPending();
  }

  /** AC-nutrition-003-05 y 07: alérgenos del alimento que coinciden con las alergias del perfil local (sin conexión). */
  async foodConflicts(food: LocalFood): Promise<string[]> {
    const allergies = (await this.store.getProfile()).profile?.allergies ?? [];
    return allergenConflicts(allergies, food.allergens ?? []);
  }

  private async entryConflicts(entries: LocalFoodEntry[]): Promise<Record<string, string[]>> {
    const allergies = (await this.store.getProfile()).profile?.allergies ?? [];
    if (allergies.length === 0) return {};
    const foods = await this.store.getFoods();
    const found: Record<string, string[]> = {};
    for (const e of entries) {
      const food = foods.find((f) => f.id === e.foodId);
      const conflicts = food ? allergenConflicts(allergies, food.allergens ?? []) : [];
      if (conflicts.length > 0) found[e.id] = conflicts;
    }
    return found;
  }

  // ---------- lo comido ----------

  /** AC-nutrition-001-10, 16, 19: guarda la entrada con la copia de los valores de esa cantidad y la intenta enviar. */
  async saveEntry(
    input: { date: string; meal: string; grams: string; foodId: string }, existingId?: string,
  ): Promise<SaveEntryResult> {
    const issues: EntryIssue[] = [];
    const date = input.date.trim();
    if (!isRealDate(date)) issues.push({ field: 'date', message: 'La fecha debe tener el formato AAAA-MM-DD.' });
    else if (date < EARLIEST_DATE) issues.push({ field: 'date', message: 'La fecha no es válida.' });
    else if (date > addDays(this.today(), 1)) issues.push({ field: 'date', message: 'La fecha no puede ser futura.' });

    const meal = normalizeMeal(input.meal);
    if (meal.length < 1 || meal.length > MEAL_MAX_LENGTH) {
      issues.push({ field: 'meal', message: `La comida lleva entre 1 y ${MEAL_MAX_LENGTH} caracteres.` });
    }

    const gramsText = input.grams.trim();
    const grams = /^\d+$/.test(gramsText) ? Number(gramsText) : Number.NaN;
    if (!(grams >= MIN_GRAMS && grams <= MAX_GRAMS)) issues.push({ field: 'grams', message: `Los gramos van de ${MIN_GRAMS} a ${MAX_GRAMS}.` });

    const food = await this.store.getFood(input.foodId);
    if (!food || !isVisible(food)) issues.push({ field: 'food', message: 'Elige un alimento de tu lista.' });
    if (issues.length > 0 || !food) return { ok: false, issues };

    const portion = portionOf(food.kcalPer100g, food.proteinPer100g, food.fatPer100g, food.carbsPer100g, grams);
    const micros = microsOf(food.fiberPer100g ?? null, food.sugarsPer100g ?? null, food.sodiumMgPer100g ?? null, grams);
    const existing = existingId ? await this.store.getFoodEntry(existingId) : null;
    const entry: LocalFoodEntry = {
      id: existingId ?? this.newId(), date, meal, foodId: food.id, grams, name: food.name, ...portion, ...micros, recipeId: null, servings: null,
      status: 'pending', message: null, pendingOp: 'upsert', attempted: existing?.attempted ?? false,
    };
    await this.store.saveFoodEntry(entry);
    await this.syncPending();
    return { ok: true, entry: (await this.store.getFoodEntry(entry.id)) ?? entry };
  }

  /** AC-nutrition-001-19: desaparece del día de inmediato; si nunca se intentó enviar no se envía nada. */
  async deleteEntry(id: string): Promise<void> {
    const row = await this.store.getFoodEntry(id);
    if (!row) return;
    if (!row.attempted) {
      await this.store.deleteFoodEntry(id);
      return;
    }
    await this.store.saveFoodEntry({ ...row, status: 'pending', message: null, pendingOp: 'delete' });
    await this.syncPending();
  }

  /** Descarta un cambio rechazado; al abrir el día vuelve la versión del servidor, si la hay. */
  async discardEntry(id: string): Promise<void> {
    await this.store.deleteFoodEntry(id);
  }

  async discardFood(id: string): Promise<void> {
    await this.store.deleteFood(id);
  }

  // ---------- objetivo ajustado (SPEC-nutrition-002) ----------

  /** AC-nutrition-002-09 y 10: fija las calorías diarias. Se aplica al instante en el teléfono y se envía en cuanto hay conexión. */
  async setOverride(text: string): Promise<SetOverrideResult> {
    const clean = text.trim();
    const calories = /^\d+$/.test(clean) ? Number(clean) : Number.NaN;
    if (!(calories >= MIN_OVERRIDE_CALORIES && calories <= MAX_OVERRIDE_CALORIES)) {
      return { ok: false, message: `Las calorías van de ${MIN_OVERRIDE_CALORIES} a ${MAX_OVERRIDE_CALORIES}.` };
    }
    if ((await this.getTargetState()).kind !== 'target') {
      return { ok: false, message: 'Para ajustar tu objetivo hace falta que antes se calcule (perfil y peso).' };
    }
    await this.setPending({ op: 'put', calories });
    await this.syncPending();
    return { ok: true };
  }

  /** AC-nutrition-002-09: vuelve al valor calculado; igual que el ajuste, primero en el teléfono. */
  async clearOverride(): Promise<void> {
    await this.setPending({ op: 'delete' });
    await this.syncPending();
  }

  private async getPending(): Promise<PendingOverride | null> {
    const stored = await this.store.getSetting(OVERRIDE_PENDING_KEY);
    return stored ? (JSON.parse(stored) as PendingOverride) : null;
  }

  private setPending(pending: PendingOverride | null): Promise<void> {
    return this.store.setSetting(OVERRIDE_PENDING_KEY, pending ? JSON.stringify(pending) : '');
  }

  /** Envía el último cambio pendiente; si mientras tanto la persona hizo otro, se queda para la siguiente pasada. */
  private async sendOverride(pending: PendingOverride): Promise<boolean> {
    const accepted = pending.op === 'put'
      ? await this.remote.putTargetOverride(pending.calories)
      : { kind: (await this.remote.deleteTargetOverride()) === 'ok' ? 'ok' : 'retry' } as const;
    if (accepted.kind === 'retry') return false;

    // 'rejected' solo ocurre si falta perfil o peso, o el valor es inválido: no hay nada que reintentar y se muestra el de la API.
    const current = await this.getPending();
    if (JSON.stringify(current) === JSON.stringify(pending)) await this.setPending(null);
    return true;
  }

  // ---------- historial (SPEC-nutrition-006) ----------

  /**
   * AC-nutrition-006-08 y 09: lo consumido en las últimas semanas. Con conexión trae el historial de la API y lo guarda;
   * sin ella usa el último recibido. Los días de los que el teléfono tiene entradas mandan sobre eso (incluye lo pendiente de
   * enviar y lo que se borró aquí). El objetivo es el último recibido de la API (el de hoy para todo el rango).
   */
  async loadHistory(weeks: number): Promise<HistoryView> {
    const count = Math.min(Math.max(1, Math.floor(weeks)), MAX_HISTORY_WEEKS);
    await this.syncPending();
    const today = this.today();
    const from = addDaysIso(mondayOf(today), -7 * (count - 1));

    const fetched = await this.remote.fetchNutritionHistory(from, today);
    if (fetched) await this.store.setSetting(HISTORY_KEY, JSON.stringify(fetched));
    const source = fetched ?? (JSON.parse((await this.store.getSetting(HISTORY_KEY)) || 'null') as typeof fetched);

    const byDate = new Map<string, DayIntake>();
    for (const d of source?.days ?? []) {
      if (d.logged && d.date >= from && d.date <= today) byDate.set(d.date, { date: d.date, kcal: d.kcal, proteinG: d.proteinG, fatG: d.fatG, carbsG: d.carbsG });
    }
    for (let date = from; date <= today; date = addDaysIso(date, 1)) {
      const local = await this.store.getFoodEntries(date);
      if (local.length === 0) continue;
      const live = local.filter((e) => isVisible(e) && e.status !== 'rejected');
      if (live.length === 0) {
        byDate.delete(date);
        continue;
      }
      const totals = sumPortions(live);
      byDate.set(date, { date, kcal: totals.kcal, proteinG: totals.proteinG, fatG: totals.fatG, carbsG: totals.carbsG });
    }

    const state = await this.getTargetState();
    const targetKcal = source?.targets?.calories ?? (state.kind === 'target' ? state.target.calories : null);
    const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { weeks: weeklyIntake(days, targetKcal), days, targetKcal, offline: fetched === null };
  }

  // ---------- recetas (SPEC-nutrition-005) ----------

  /** Recetas propias que no esperan borrarse, por nombre. */
  async listRecipes(): Promise<LocalRecipe[]> {
    return (await this.store.getRecipes()).filter(isVisible).sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
  }

  /** AC-nutrition-005-01, 02, 09: valida con las reglas de la API, copia los valores de los alimentos y la intenta enviar. */
  async saveRecipe(raw: RawRecipeInput, existingId?: string): Promise<SaveRecipeResult> {
    const issues: RecipeIssue[] = [];
    const name = raw.name.trim();
    if (name.length < 1 || name.length > 80) issues.push({ field: 'name', message: 'El nombre lleva entre 1 y 80 caracteres.' });
    const servingsText = raw.servings.trim();
    const servings = /^\d+$/.test(servingsText) ? Number(servingsText) : Number.NaN;
    if (!(servings >= 1 && servings <= MAX_RECIPE_SERVINGS)) issues.push({ field: 'servings', message: `Las raciones van de 1 a ${MAX_RECIPE_SERVINGS}.` });
    if (raw.ingredients.length < 1 || raw.ingredients.length > MAX_INGREDIENTS) {
      issues.push({ field: 'ingredients', message: `Una receta lleva entre 1 y ${MAX_INGREDIENTS} ingredientes.` });
    }
    if (new Set(raw.ingredients.map((i) => i.foodId)).size !== raw.ingredients.length) {
      issues.push({ field: 'ingredients', message: 'Un alimento no puede repetirse en la receta.' });
    }

    const ingredients: LocalIngredient[] = [];
    for (const i of raw.ingredients) {
      const gramsText = i.grams.trim();
      const grams = /^\d+$/.test(gramsText) ? Number(gramsText) : Number.NaN;
      if (!(grams >= MIN_GRAMS && grams <= MAX_GRAMS)) issues.push({ field: 'grams', message: `Los gramos van de ${MIN_GRAMS} a ${MAX_GRAMS}.` });
      const food = await this.store.getFood(i.foodId);
      if (!food || !isVisible(food)) {
        issues.push({ field: 'food', message: 'Cada ingrediente debe ser un alimento de tu lista.' });
        continue;
      }
      ingredients.push({
        foodId: food.id, name: food.name, grams, kcalPer100g: food.kcalPer100g, proteinPer100g: food.proteinPer100g,
        fatPer100g: food.fatPer100g, carbsPer100g: food.carbsPer100g, fiberPer100g: food.fiberPer100g ?? null,
        sugarsPer100g: food.sugarsPer100g ?? null, sodiumMgPer100g: food.sodiumMgPer100g ?? null,
      });
    }
    if (issues.length > 0) return { ok: false, issues };

    const existing = existingId ? await this.store.getRecipe(existingId) : null;
    const recipe: LocalRecipe = {
      id: existingId ?? this.newId(), name, servings, ingredients, status: 'pending', message: null, pendingOp: 'upsert',
      attempted: existing?.attempted ?? false,
    };
    await this.store.saveRecipe(recipe);
    await this.syncPending();
    return { ok: true, recipe: (await this.store.getRecipe(recipe.id)) ?? recipe };
  }

  /** Quita la receta de la lista; lo ya comido conserva sus valores (AC-nutrition-005-04). */
  async deleteRecipe(id: string): Promise<void> {
    const row = await this.store.getRecipe(id);
    if (!row) return;
    if (!row.attempted) {
      await this.store.deleteRecipe(id);
      return;
    }
    await this.store.saveRecipe({ ...row, status: 'pending', message: null, pendingOp: 'delete' });
    await this.syncPending();
  }

  async discardRecipe(id: string): Promise<void> {
    await this.store.deleteRecipe(id);
  }

  /** AC-nutrition-005-04 y 09: registra unas raciones de una receta; la entrada copia los valores de esa cantidad. */
  async saveRecipeEntry(
    input: { date: string; meal: string; servings: string; recipeId: string }, existingId?: string,
  ): Promise<SaveEntryResult> {
    const issues: EntryIssue[] = [];
    const date = input.date.trim();
    if (!isRealDate(date)) issues.push({ field: 'date', message: 'La fecha debe tener el formato AAAA-MM-DD.' });
    else if (date < EARLIEST_DATE) issues.push({ field: 'date', message: 'La fecha no es válida.' });
    else if (date > addDays(this.today(), 1)) issues.push({ field: 'date', message: 'La fecha no puede ser futura.' });

    const meal = normalizeMeal(input.meal);
    if (meal.length < 1 || meal.length > MEAL_MAX_LENGTH) {
      issues.push({ field: 'meal', message: `La comida lleva entre 1 y ${MEAL_MAX_LENGTH} caracteres.` });
    }

    const servingsText = input.servings.trim().replace(',', '.');
    const servings = /^\d+(\.\d{1,2})?$/.test(servingsText) ? Number(servingsText) : Number.NaN;
    if (!(servings >= MIN_SERVINGS && servings <= MAX_SERVINGS)) {
      issues.push({ field: 'grams', message: 'Las raciones van de 0,25 a 20, con hasta dos decimales.' });
    }

    const recipe = await this.store.getRecipe(input.recipeId);
    if (!recipe || !isVisible(recipe)) issues.push({ field: 'food', message: 'Elige una receta de tu lista.' });
    if (issues.length > 0 || !recipe) return { ok: false, issues };

    const eaten = scaleRecipe(recipeTotal(recipe.ingredients), recipe.servings, servings);
    const existing = existingId ? await this.store.getFoodEntry(existingId) : null;
    const entry: LocalFoodEntry = {
      id: existingId ?? this.newId(), date, meal, foodId: null, grams: 0, name: recipe.name,
      kcal: eaten.kcal, proteinG: eaten.proteinG, fatG: eaten.fatG, carbsG: eaten.carbsG,
      fiberG: eaten.fiberG, sugarsG: eaten.sugarsG, sodiumMg: eaten.sodiumMg, recipeId: recipe.id, servings,
      status: 'pending', message: null, pendingOp: 'upsert', attempted: existing?.attempted ?? false,
    };
    await this.store.saveFoodEntry(entry);
    await this.syncPending();
    return { ok: true, entry: (await this.store.getFoodEntry(entry.id)) ?? entry };
  }

  private async sendRecipeDelete(r: LocalRecipe): Promise<boolean> {
    if ((await this.remote.deleteRecipe(r.id)) === 'retry') return false;
    await this.store.deleteRecipe(r.id);
    return true;
  }

  private async sendRecipe(recipe: LocalRecipe): Promise<boolean> {
    const sending = { ...recipe, attempted: true };
    await this.store.saveRecipe(sending);
    const result = await this.remote.putRecipe({ id: sending.id, name: sending.name, servings: sending.servings, ingredients: sending.ingredients });
    if (result.kind === 'retry') return false;

    const current = await this.store.getRecipe(recipe.id);
    const same = (a: LocalRecipe, b: LocalRecipe) => JSON.stringify([a.name, a.servings, a.ingredients]) === JSON.stringify([b.name, b.servings, b.ingredients]);
    if (!current || current.pendingOp !== 'upsert' || !same(current, sending)) return true;
    await this.store.saveRecipe(
      result.kind === 'ok'
        ? { ...current, status: 'synced', message: null, pendingOp: null }
        : { ...current, status: 'rejected', message: result.reason },
    );
    return true;
  }

  // ---------- agua (SPEC-nutrition-004) ----------

  /** AC-06, 09 y 10: suma agua al día; se guarda en el teléfono con un id del dispositivo y se envía en cuanto hay conexión. */
  async addWater(ml: number, date: string = this.today()): Promise<{ ok: true; water: LocalWater } | { ok: false; message: string }> {
    if (!Number.isInteger(ml) || ml < MIN_WATER_ML || ml > MAX_WATER_ML) {
      return { ok: false, message: `Los mililitros van de ${MIN_WATER_ML} a ${MAX_WATER_ML}.` };
    }
    const water: LocalWater = { id: this.newId(), date, ml, status: 'pending', message: null, pendingOp: 'upsert', attempted: false };
    await this.store.saveWater(water);
    await this.syncPending();
    return { ok: true, water: (await this.store.getWaterEntry(water.id)) ?? water };
  }

  /** Deshacer o borrar un registro de agua; si nunca se intentó enviar no se envía nada. */
  async removeWater(id: string): Promise<void> {
    const row = await this.store.getWaterEntry(id);
    if (!row) return;
    if (!row.attempted) {
      await this.store.deleteWater(id);
      return;
    }
    await this.store.saveWater({ ...row, status: 'pending', message: null, pendingOp: 'delete' });
    await this.syncPending();
  }

  async discardWater(id: string): Promise<void> {
    await this.store.deleteWater(id);
  }

  private async sendWaterDelete(w: LocalWater): Promise<boolean> {
    if ((await this.remote.deleteWaterEntry(w.id)) === 'retry') return false;
    await this.store.deleteWater(w.id);
    return true;
  }

  private async sendWater(water: LocalWater): Promise<boolean> {
    const sending = { ...water, attempted: true };
    await this.store.saveWater(sending);
    const result = await this.remote.putWaterEntry({ id: sending.id, date: sending.date, ml: sending.ml });
    if (result.kind === 'retry') return false;

    const current = await this.store.getWaterEntry(water.id);
    if (!current || current.pendingOp !== 'upsert' || current.date !== sending.date || current.ml !== sending.ml) return true;
    await this.store.saveWater(
      result.kind === 'ok'
        ? { ...current, status: 'synced', message: null, pendingOp: null }
        : { ...current, status: 'rejected', message: result.reason },
    );
    return true;
  }

  // ---------- envío ----------

  syncPending(): Promise<void> {
    const run = this.chain.then(() => this.doSync());
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Borrados de entradas, alimentos nuevos, entradas nuevas y borrados de alimentos; se detiene ante un error de red. */
  private async doSync(): Promise<void> {
    const { foods, entries } = await this.store.getPendingNutrition();
    const override = await this.getPending();
    const water = await this.store.getPendingWater();
    const recipes = await this.store.getPendingRecipes();
    const stages: (() => Promise<boolean>)[] = [
      ...(override ? [() => this.sendOverride(override)] : []),
      ...water.filter((w) => w.pendingOp === 'delete').map((w) => () => this.sendWaterDelete(w)),
      ...entries.filter((e) => e.pendingOp === 'delete').map((e) => () => this.sendEntryDelete(e)),
      ...foods.filter((f) => f.pendingOp === 'upsert').map((f) => () => this.sendFood(f)),
      ...recipes.filter((r) => r.pendingOp === 'upsert').map((r) => () => this.sendRecipe(r)),
      ...entries.filter((e) => e.pendingOp === 'upsert').sort((a, b) => a.date.localeCompare(b.date)).map((e) => () => this.sendEntry(e)),
      ...water.filter((w) => w.pendingOp === 'upsert').map((w) => () => this.sendWater(w)),
      ...recipes.filter((r) => r.pendingOp === 'delete').map((r) => () => this.sendRecipeDelete(r)),
      ...foods.filter((f) => f.pendingOp === 'delete').map((f) => () => this.sendFoodDelete(f)),
    ];
    for (const stage of stages) if (!(await stage())) break;
  }

  private async sendEntryDelete(e: LocalFoodEntry): Promise<boolean> {
    if ((await this.remote.deleteFoodEntry(e.id)) === 'retry') return false;
    await this.store.deleteFoodEntry(e.id);
    return true;
  }

  private async sendFoodDelete(f: LocalFood): Promise<boolean> {
    if ((await this.remote.deleteFood(f.id)) === 'retry') return false;
    await this.store.deleteFood(f.id);
    return true;
  }

  private async sendFood(food: LocalFood): Promise<boolean> {
    // Se marca como intentado antes de enviar: si la app se cierra a mitad, puede haber llegado.
    const sending = { ...food, attempted: true };
    await this.store.saveFood(sending);
    const result = await this.remote.putFood(foodToServer(sending));
    if (result.kind === 'retry') return false;

    // Si mientras se enviaba la persona lo editó, ese cambio se envía en la siguiente pasada.
    const current = await this.store.getFood(food.id);
    if (!current || current.pendingOp !== 'upsert' || JSON.stringify(foodToServer(current)) !== JSON.stringify(foodToServer(sending))) return true;
    await this.store.saveFood(
      result.kind === 'ok'
        ? { ...current, status: 'synced', message: null, pendingOp: null }
        : { ...current, status: 'rejected', message: result.reason },
    );
    return true;
  }

  private async sendEntry(entry: LocalFoodEntry): Promise<boolean> {
    const sending = { ...entry, attempted: true };
    await this.store.saveFoodEntry(sending);
    const result = await this.remote.putFoodEntry({
      id: sending.id, date: sending.date, meal: sending.meal, foodId: sending.foodId, grams: sending.grams,
      recipeId: sending.recipeId, servings: sending.servings,
    });
    if (result.kind === 'retry') return false;

    const current = await this.store.getFoodEntry(entry.id);
    const same = (a: LocalFoodEntry, b: LocalFoodEntry) => a.date === b.date && a.meal === b.meal && a.foodId === b.foodId && a.grams === b.grams
      && a.recipeId === b.recipeId && a.servings === b.servings;
    if (!current || current.pendingOp !== 'upsert' || !same(current, sending)) return true;
    await this.store.saveFoodEntry(
      result.kind === 'ok'
        ? { ...current, status: 'synced', message: null, pendingOp: null }
        : { ...current, status: 'rejected', message: result.reason },
    );
    return true;
  }

  // ---------- el día ----------

  /**
   * AC-nutrition-001-15 y 18: envía lo pendiente, trae del servidor lo que no tenga cambios propios y arma el día con
   * lo del teléfono: totales calculados aquí con las mismas reglas de redondeo y el último objetivo recibido.
   */
  async loadDay(date: string): Promise<DayView> {
    await this.syncPending();
    await this.hydrate(date);
    await this.refreshTarget();

    const entries = (await this.store.getFoodEntries(date)).filter(isVisible);
    const byMeal = new Map<string, LocalFoodEntry[]>();
    for (const e of entries) byMeal.set(e.meal, [...(byMeal.get(e.meal) ?? []), e]);
    const meals = [...byMeal.entries()]
      .sort(([a], [b]) => mealOrder(a) - mealOrder(b) || a.localeCompare(b))
      .map(([name, list]) => ({ name, entries: list.sort((a, b) => a.id.localeCompare(b.id)) }));

    // Lo rechazado no está en el servidor: no cuenta en los totales.
    const totals = sumPortions(entries.filter((e) => e.status !== 'rejected'));
    const target = await this.getTargetState();
    const remaining = target.kind === 'target'
      ? {
          kcal: target.target.calories - totals.kcal,
          proteinG: Math.round((target.target.proteinG - totals.proteinG) * 10) / 10,
          fatG: Math.round((target.target.fatG - totals.fatG) * 10) / 10,
          carbsG: Math.round((target.target.carbsG - totals.carbsG) * 10) / 10,
        }
      : null;
    const micros = sumMicros(entries.filter((e) => e.status !== 'rejected').map((e) => ({
      fiberG: e.fiberG ?? null, sugarsG: e.sugarsG ?? null, sodiumMg: e.sodiumMg ?? null,
    })));
    const water = (await this.store.getWater(date)).filter(isVisible);
    const waterMl = water.filter((w) => w.status !== 'rejected').reduce((acc, w) => acc + w.ml, 0);
    return { date, meals, totals, target, remaining, micros, water, waterMl, conflicts: await this.entryConflicts(entries) };
  }

  /** Con conexión y sin cambios propios por enviar ni rechazados, la API es la fuente de verdad. */
  private async hydrate(date: string): Promise<void> {
    const foods = await this.store.getFoods();
    if (foods.every((f) => f.status === 'synced' && f.pendingOp === null)) {
      const served = await this.remote.fetchFoods();
      if (served) await this.store.replaceSyncedFoods(served);
    }

    const recipes = await this.store.getRecipes();
    if (recipes.every((r) => r.status === 'synced' && r.pendingOp === null)) {
      const served = await this.remote.fetchRecipes();
      if (served) await this.store.replaceSyncedRecipes(served);
    }

    const water = await this.store.getWater(date);
    if (water.every((w) => w.status === 'synced' && w.pendingOp === null)) {
      const served = await this.remote.fetchDayWater(date);
      if (served) await this.store.replaceSyncedWater(date, served);
    }

    const entries = await this.store.getFoodEntries(date);
    if (entries.every((e) => e.status === 'synced' && e.pendingOp === null)) {
      const served = await this.remote.fetchDayEntries(date);
      if (served) await this.store.replaceSyncedFoodEntries(date, served);
    }
  }

  async refreshTarget(): Promise<void> {
    // Con un ajuste pendiente (no llegó a la API) manda el del teléfono: una respuesta vieja no lo pisa (AC-nutrition-002-10).
    if ((await this.getPending()) !== null) return;
    const response = await this.remote.fetchTargets();
    if (response === null) return; // sin conexión: se conserva el último
    if (response.kind === 'ok') {
      await this.store.setSetting(TARGET_KEY, JSON.stringify({ target: response.target, calculatedAt: this.today() }));
      await this.store.setSetting(MISSING_KEY, '');
    } else {
      await this.store.setSetting(MISSING_KEY, response.what);
      await this.store.setSetting(TARGET_KEY, '');
    }
  }

  async getTargetState(): Promise<TargetState> {
    const missing = await this.store.getSetting(MISSING_KEY);
    if (missing === 'perfil' || missing === 'peso') return { kind: 'missing', what: missing };
    const stored = await this.store.getSetting(TARGET_KEY);
    if (!stored) return { kind: 'unknown' };
    const parsed = JSON.parse(stored) as { target: NutritionTarget; calculatedAt: string };

    const pending = await this.getPending();
    if (!pending) return { kind: 'target', target: parsed.target, calculatedAt: parsed.calculatedAt, pending: false };

    // Ajuste hecho sin conexión: calorías elegidas (o las calculadas) y macros con las mismas reglas que la API, usando
    // el peso del último objetivo recibido y la meta del perfil local (AC-nutrition-002-03 y 10).
    const profile = (await this.store.getProfile()).profile;
    if (!profile) return { kind: 'target', target: parsed.target, calculatedAt: parsed.calculatedAt, pending: true };
    const calories = pending.op === 'put' ? pending.calories : parsed.target.calculatedCalories;
    const macros = macrosFor(calories, parsed.target.weightKg, profile.goal);
    return {
      kind: 'target',
      calculatedAt: parsed.calculatedAt,
      pending: true,
      target: { ...parsed.target, calories, ...macros, source: pending.op === 'put' ? 'manual' : 'calculated' },
    };
  }
}
