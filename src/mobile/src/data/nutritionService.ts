import { fold, MAX_GRAMS, MEAL_MAX_LENGTH, MIN_GRAMS, mealOrder, normalizeMeal, portionOf, sumPortions, type Portion } from './nutritionRules';
import type { LocalFood, LocalFoodEntry, LocalStore, NutritionApi, NutritionTarget, ServerFood } from './types';

const TARGET_KEY = 'nutritionTarget';
const MISSING_KEY = 'nutritionMissing';
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
  source: 'manual' | 'openfoodfacts';
}

export interface FoodIssue {
  field: 'name' | 'brand' | 'barcode' | 'kcal' | 'protein' | 'fat' | 'carbs' | 'total';
  message: string;
}

export interface EntryIssue {
  field: 'date' | 'meal' | 'grams' | 'food';
  message: string;
}

export type SaveFoodResult =
  | { ok: true; food: LocalFood }
  | { ok: false; issues: FoodIssue[]; /** Alimento propio con el mismo código de barras, para usarlo en lugar de crear otro. */ duplicateOf?: string };

export type SaveEntryResult = { ok: true; entry: LocalFoodEntry } | { ok: false; issues: EntryIssue[] };

export interface MealGroup {
  name: string;
  entries: LocalFoodEntry[];
}

/** Objetivo que se muestra: el último recibido de la API (con su fecha), lo que falta, o nada sabido. */
export type TargetState =
  | { kind: 'target'; target: NutritionTarget; calculatedAt: string }
  | { kind: 'missing'; what: 'perfil' | 'peso' }
  | { kind: 'unknown' };

export interface DayView {
  date: string;
  meals: MealGroup[];
  totals: Portion;
  target: TargetState;
  /** Objetivo menos lo consumido; negativo si se pasó. Null sin objetivo. */
  remaining: Portion | null;
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

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    draft: {
      name, brand: brand || null, barcode: barcode || null, kcalPer100g: kcal, proteinPer100g: protein,
      fatPer100g: fat, carbsPer100g: carbs, source: raw.source,
    },
  };
}

const foodToServer = (f: LocalFood): ServerFood => ({
  id: f.id, name: f.name, brand: f.brand, barcode: f.barcode, kcalPer100g: f.kcalPer100g, proteinPer100g: f.proteinPer100g,
  fatPer100g: f.fatPer100g, carbsPer100g: f.carbsPer100g, source: f.source,
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
    const existing = existingId ? await this.store.getFoodEntry(existingId) : null;
    const entry: LocalFoodEntry = {
      id: existingId ?? this.newId(), date, meal, foodId: food.id, grams, name: food.name, ...portion,
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

  // ---------- envío ----------

  syncPending(): Promise<void> {
    const run = this.chain.then(() => this.doSync());
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** Borrados de entradas, alimentos nuevos, entradas nuevas y borrados de alimentos; se detiene ante un error de red. */
  private async doSync(): Promise<void> {
    const { foods, entries } = await this.store.getPendingNutrition();
    const stages: (() => Promise<boolean>)[] = [
      ...entries.filter((e) => e.pendingOp === 'delete').map((e) => () => this.sendEntryDelete(e)),
      ...foods.filter((f) => f.pendingOp === 'upsert').map((f) => () => this.sendFood(f)),
      ...entries.filter((e) => e.pendingOp === 'upsert').sort((a, b) => a.date.localeCompare(b.date)).map((e) => () => this.sendEntry(e)),
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
    });
    if (result.kind === 'retry') return false;

    const current = await this.store.getFoodEntry(entry.id);
    const same = (a: LocalFoodEntry, b: LocalFoodEntry) => a.date === b.date && a.meal === b.meal && a.foodId === b.foodId && a.grams === b.grams;
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
    return { date, meals, totals, target, remaining };
  }

  /** Con conexión y sin cambios propios por enviar ni rechazados, la API es la fuente de verdad. */
  private async hydrate(date: string): Promise<void> {
    const foods = await this.store.getFoods();
    if (foods.every((f) => f.status === 'synced' && f.pendingOp === null)) {
      const served = await this.remote.fetchFoods();
      if (served) await this.store.replaceSyncedFoods(served);
    }

    const entries = await this.store.getFoodEntries(date);
    if (entries.every((e) => e.status === 'synced' && e.pendingOp === null)) {
      const served = await this.remote.fetchDayEntries(date);
      if (served) await this.store.replaceSyncedFoodEntries(date, served);
    }
  }

  async refreshTarget(): Promise<void> {
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
    return { kind: 'target', target: parsed.target, calculatedAt: parsed.calculatedAt };
  }
}
