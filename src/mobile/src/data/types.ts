// Tipos compartidos de SPEC-mobile-002. Sin dependencias de React Native: la lógica se prueba en Node.

export const DAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const;
export type DayKey = (typeof DAYS)[number];

/** Letras de los botones del selector de días: L M X J V S D. */
export const DAY_LETTERS: Record<DayKey, string> = {
  lunes: 'L', martes: 'M', miercoles: 'X', jueves: 'J', viernes: 'V', sabado: 'S', domingo: 'D',
};

export const DAY_NAMES: Record<DayKey, string> = {
  lunes: 'Lunes', martes: 'Martes', miercoles: 'Miércoles', jueves: 'Jueves',
  viernes: 'Viernes', sabado: 'Sábado', domingo: 'Domingo',
};

export interface CatalogExercise {
  id: string;
  name: string;
  primaryZone: string;
  secondaryZones: string[];
  movements: string[];
  equipment: string;
  bar: string | null;
  images: string[];
}

export interface CatalogSection {
  name: string;
  exercises: CatalogExercise[];
}

export interface LocalPlanEntry {
  id: string;
  exerciseId: string;
  order: number;
  machineStepKg: number | null;
}

/** pendiente → sincronizado | rechazado | necesita confirmación (la API pidió confirmar un aviso). */
export type SyncStatus = 'pending' | 'synced' | 'rejected' | 'needs_confirmation';

export interface DayState {
  day: DayKey;
  status: SyncStatus;
  /** Motivo del rechazo o texto del aviso. */
  message: string | null;
  entries: LocalPlanEntry[];
}

export interface EquipmentProfile {
  dumbbellsKg: number[];
  /** Claves: recta, z, smith, remo_en_t. */
  barsKg: Record<string, number>;
  discsKg: number[];
  machineStepKg: number;
  machineBaseKg: number;
}

export interface EquipmentState {
  profile: EquipmentProfile | null;
  status: SyncStatus;
  message: string | null;
}

/**
 * Registro de un ejercicio en una fecha (SPEC-mobile-003). Los nombres de los campos son los de la API.
 * `pendingOp` dice qué falta enviar; `attempted` recuerda si ya se intentó enviar (puede haber llegado).
 */
export interface LocalExerciseLog {
  id: string;
  exerciseId: string;
  /** Día local, AAAA-MM-DD. */
  date: string;
  loadKg: number;
  firstSetReps: number;
  secondSetReps: number;
  secondSetAssistedReps: number;
  /** heavy_duty_personalizado (por defecto si falta) o normal_4x15 (SPEC-training-004). */
  methodology?: string;
  /** Solo 4×15: repeticiones propias de las 4 series. Entonces firstSetReps y secondSetReps repiten la serie 1 y la 4. */
  repsPerSet?: number[] | null;
  /** pending → synced | rejected. `needs_confirmation` no se usa en los registros. */
  status: SyncStatus;
  message: string | null;
  pendingOp: 'upsert' | 'delete' | null;
  attempted: boolean;
}

/** Lo que guarda el servidor de un registro (historial). */
export type ServerExerciseLog = Pick<
  LocalExerciseLog,
  'id' | 'exerciseId' | 'date' | 'loadKg' | 'firstSetReps' | 'secondSetReps' | 'secondSetAssistedReps' | 'methodology' | 'repsPerSet'
>;

export type Sex = 'masculino' | 'femenino';
export type Goal = 'bajar_grasa' | 'ganar_musculo' | 'mantener';
export type ActivityLevel = 'sedentario' | 'ligero' | 'moderado' | 'muy_activo';
export type ExperienceLevel = 'principiante' | 'intermedio' | 'avanzado';
export type RestrictionLevel = 'contexto' | 'aviso' | 'bloqueo';

/** Perfil de la persona (SPEC-profile-001). Los nombres de los campos son los de la API. */
export interface LocalProfile {
  displayName: string;
  sex: Sex;
  /** AAAA-MM-DD. */
  birthDate: string;
  heightCm: number;
  goal: Goal;
  activityLevel: ActivityLevel;
  experienceLevel: ExperienceLevel | null;
  daysPerWeek: number | null;
  methodology: string;
  allergies: string[];
}

export interface ProfileState {
  profile: LocalProfile | null;
  status: SyncStatus;
  message: string | null;
}

/** Restricción médica o de movimiento de la persona (P3). */
export interface RestrictionItem {
  id: string;
  zone: string;
  avoidedMovements: string[];
  level: RestrictionLevel;
  /** AAAA-MM-DD o null. */
  reviewOn: string | null;
}

// ---- Nutrición (SPEC-nutrition-001) ----

/** Alimento propio con sus valores por 100 g. `pendingOp` dice qué falta enviar; `attempted`, si ya se intentó. */
export interface LocalFood {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  source: 'manual' | 'openfoodfacts';
  /** Alérgenos declarados (SPEC-nutrition-003); vacío = sin dato. */
  allergens: string[];
  /** Por 100 g (SPEC-nutrition-004); null = sin dato (no es cero). */
  fiberPer100g: number | null;
  sugarsPer100g: number | null;
  sodiumMgPer100g: number | null;
  status: SyncStatus;
  message: string | null;
  pendingOp: 'upsert' | 'delete' | null;
  attempted: boolean;
}

/** Lo comido: copia el nombre y los valores de la cantidad, como la API. */
export interface LocalFoodEntry {
  id: string;
  /** Día local, AAAA-MM-DD. */
  date: string;
  /** desayuno, almuerzo, cena, snack o un nombre libre. */
  meal: string;
  foodId: string | null;
  grams: number;
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  /** Copia de esa cantidad (SPEC-nutrition-004); null = el alimento no tenía el dato. */
  fiberG: number | null;
  sugarsG: number | null;
  sodiumMg: number | null;
  /** Receta registrada (SPEC-nutrition-005): con ella `grams` es 0 y vale `servings`. */
  recipeId: string | null;
  servings: number | null;
  status: SyncStatus;
  message: string | null;
  pendingOp: 'upsert' | 'delete' | null;
  attempted: boolean;
}

/** Ingrediente de una receta con la copia de los valores del alimento al guardarla (SPEC-nutrition-005). */
export interface LocalIngredient {
  /** null = el alimento se borró («alimento eliminado»). */
  foodId: string | null;
  name: string;
  grams: number;
  kcalPer100g: number;
  proteinPer100g: number;
  fatPer100g: number;
  carbsPer100g: number;
  fiberPer100g: number | null;
  sugarsPer100g: number | null;
  sodiumMgPer100g: number | null;
}

export interface LocalRecipe {
  id: string;
  name: string;
  servings: number;
  ingredients: LocalIngredient[];
  status: SyncStatus;
  message: string | null;
  pendingOp: 'upsert' | 'delete' | null;
  attempted: boolean;
}

export type ServerRecipe = Pick<LocalRecipe, 'id' | 'name' | 'servings' | 'ingredients'>;

/** Agua bebida en un día, en mililitros (SPEC-nutrition-004). */
export interface LocalWater {
  id: string;
  /** Día local, AAAA-MM-DD. */
  date: string;
  ml: number;
  status: SyncStatus;
  message: string | null;
  pendingOp: 'upsert' | 'delete' | null;
  attempted: boolean;
}

export type ServerWater = Pick<LocalWater, 'id' | 'date' | 'ml'>;

export type ServerFood = Pick<
  LocalFood,
  'id' | 'name' | 'brand' | 'barcode' | 'kcalPer100g' | 'proteinPer100g' | 'fatPer100g' | 'carbsPer100g' | 'source' | 'allergens'
> & Partial<Pick<LocalFood, 'fiberPer100g' | 'sugarsPer100g' | 'sodiumMgPer100g'>>;

export type ServerFoodEntry = Pick<
  LocalFoodEntry,
  'id' | 'date' | 'meal' | 'foodId' | 'grams' | 'name' | 'kcal' | 'proteinG' | 'fatG' | 'carbsG'
> & Partial<Pick<LocalFoodEntry, 'fiberG' | 'sugarsG' | 'sodiumMg' | 'recipeId' | 'servings'>>;

/** Objetivo diario que calcula la API. */
export interface NutritionTarget {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  basalKcal: number;
  weightKg: number;
  weightDate: string;
  /** Calorías que darían las reglas, aunque la persona haya ajustado las suyas. */
  calculatedCalories: number;
  /** calculated = reglas de la API; manual = calorías ajustadas por la persona (SPEC-nutrition-002). */
  source: 'calculated' | 'manual';
}

export type TargetsResponse = { kind: 'ok'; target: NutritionTarget } | { kind: 'missing'; what: 'perfil' | 'peso' };

/** Un día del historial de nutrición (SPEC-nutrition-006); sin `logged` el día no tiene entradas. */
export interface ServerHistoryDay {
  date: string;
  logged: boolean;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface ServerNutritionHistory {
  days: ServerHistoryDay[];
  targets: NutritionTarget | null;
}

/** Parte de la API de nutrición; aparte de RemoteApi para no tocar los demás módulos. */
export interface NutritionApi {
  fetchTargets(): Promise<TargetsResponse | null>; // null = sin conexión o error
  /** SPEC-nutrition-002: fija las calorías diarias a mano. */
  putTargetOverride(calories: number): Promise<PutLogResult>;
  /** SPEC-nutrition-002: vuelve al objetivo calculado. */
  deleteTargetOverride(): Promise<'ok' | 'retry'>;
  fetchFoods(): Promise<ServerFood[] | null>;
  putFood(food: ServerFood): Promise<PutLogResult>;
  deleteFood(id: string): Promise<'ok' | 'retry'>;
  /** Las entradas del día, ya sin agrupar. */
  fetchDayEntries(date: string): Promise<ServerFoodEntry[] | null>;
  putFoodEntry(entry: Pick<ServerFoodEntry, 'id' | 'date' | 'meal' | 'foodId' | 'grams' | 'recipeId' | 'servings'>): Promise<PutLogResult>;
  deleteFoodEntry(id: string): Promise<'ok' | 'retry'>;
  /** SPEC-nutrition-006: lo consumido cada día del rango y el objetivo vigente (null = sin conexión o error). */
  fetchNutritionHistory(from: string, to: string): Promise<ServerNutritionHistory | null>;
  /** SPEC-nutrition-005: recetas propias (null = sin conexión o error), y su alta y baja. */
  fetchRecipes(): Promise<ServerRecipe[] | null>;
  putRecipe(recipe: ServerRecipe): Promise<PutLogResult>;
  deleteRecipe(id: string): Promise<'ok' | 'retry'>;
  /** SPEC-nutrition-004: el agua del día (null = sin conexión o error), y su alta y baja. */
  fetchDayWater(date: string): Promise<ServerWater[] | null>;
  putWaterEntry(water: ServerWater): Promise<PutLogResult>;
  deleteWaterEntry(id: string): Promise<'ok' | 'retry'>;
}

/** Producto que devuelve Open Food Facts, con lo que se pudo leer. Los valores son por 100 g. */
export interface ScannedProduct {
  barcode: string;
  name: string | null;
  brand: string | null;
  kcalPer100g: number | null;
  proteinPer100g: number | null;
  fatPer100g: number | null;
  carbsPer100g: number | null;
  /** Opcionales: si faltan no impiden guardar (SPEC-nutrition-004). El sodio va en mg. */
  fiberPer100g?: number | null;
  sugarsPer100g?: number | null;
  sodiumMgPer100g?: number | null;
  /** Alérgenos según Open Food Facts; null = el producto no trae ese dato (no significa «sin alérgenos»). */
  allergens?: string[] | null;
}

/** AC-nutrition-001-17: completo, incompleto (falta algún valor), desconocido o sin conexión. */
export type ProductLookupResult =
  | { kind: 'found'; product: ScannedProduct }
  | { kind: 'incomplete'; product: ScannedProduct }
  | { kind: 'notFound' }
  | { kind: 'offline' };

export interface ProductLookup {
  lookup(barcode: string): Promise<ProductLookupResult>;
}

/** Almacén local (SQLite en la app, memoria en las pruebas). */
export interface LocalStore {
  getCatalog(): Promise<CatalogSection[] | null>;
  saveCatalog(sections: CatalogSection[]): Promise<void>;

  getDays(): Promise<DayState[]>;
  /** Guarda las entradas del día y lo deja `pending`. */
  saveDay(day: DayKey, entries: LocalPlanEntry[]): Promise<void>;
  /** Guarda lo que dice el servidor, ya sincronizado. */
  replaceDaySynced(day: DayKey, entries: LocalPlanEntry[]): Promise<void>;
  setDayStatus(day: DayKey, status: SyncStatus, message: string | null): Promise<void>;

  getEquipment(): Promise<EquipmentState>;
  saveEquipment(profile: EquipmentProfile): Promise<void>;
  setEquipmentStatus(status: SyncStatus, message: string | null): Promise<void>;

  getLog(id: string): Promise<LocalExerciseLog | null>;
  /** Todos los registros del ejercicio, también los que esperan borrarse. */
  getLogs(exerciseId: string): Promise<LocalExerciseLog[]>;
  /** Registros con algo por enviar (guardar o borrar) que no están rechazados. */
  getPendingLogs(): Promise<LocalExerciseLog[]>;
  /** Todos los registros del teléfono, también los que esperan borrarse (SPEC-training-006). */
  getAllLogs(): Promise<LocalExerciseLog[]>;
  saveLog(log: LocalExerciseLog): Promise<void>;
  deleteLog(id: string): Promise<void>;
  /** Sustituye todos los registros del ejercicio por lo que dice el servidor, ya sincronizados. */
  replaceSyncedLogs(exerciseId: string, logs: ServerExerciseLog[]): Promise<void>;

  getProfile(): Promise<ProfileState>;
  /** Guarda el perfil y lo deja `pending`. */
  saveProfile(profile: LocalProfile): Promise<void>;
  setProfileStatus(status: SyncStatus, message: string | null): Promise<void>;

  getFoods(): Promise<LocalFood[]>;
  getFood(id: string): Promise<LocalFood | null>;
  saveFood(food: LocalFood): Promise<void>;
  deleteFood(id: string): Promise<void>;
  /** Sustituye los alimentos ya sincronizados por lo que dice el servidor; conserva los que esperan envío. */
  replaceSyncedFoods(foods: ServerFood[]): Promise<void>;
  /** Todas las entradas del día, también las que esperan borrarse. */
  getFoodEntries(date: string): Promise<LocalFoodEntry[]>;
  getFoodEntry(id: string): Promise<LocalFoodEntry | null>;
  saveFoodEntry(entry: LocalFoodEntry): Promise<void>;
  deleteFoodEntry(id: string): Promise<void>;
  /** Alimentos y entradas con algo por enviar (guardar o borrar) que no están rechazados. */
  getPendingNutrition(): Promise<{ foods: LocalFood[]; entries: LocalFoodEntry[] }>;
  /** Sustituye las entradas ya sincronizadas del día por lo que dice el servidor; conserva las pendientes. */
  replaceSyncedFoodEntries(date: string, entries: ServerFoodEntry[]): Promise<void>;
  /** Recetas propias, también las que esperan borrarse (SPEC-nutrition-005). */
  getRecipes(): Promise<LocalRecipe[]>;
  getRecipe(id: string): Promise<LocalRecipe | null>;
  saveRecipe(recipe: LocalRecipe): Promise<void>;
  deleteRecipe(id: string): Promise<void>;
  getPendingRecipes(): Promise<LocalRecipe[]>;
  /** Sustituye las recetas ya sincronizadas por lo que dice el servidor; conserva las que esperan envío. */
  replaceSyncedRecipes(recipes: ServerRecipe[]): Promise<void>;
  /** Agua del día, también la que espera borrarse (SPEC-nutrition-004). */
  getWater(date: string): Promise<LocalWater[]>;
  getWaterEntry(id: string): Promise<LocalWater | null>;
  saveWater(water: LocalWater): Promise<void>;
  deleteWater(id: string): Promise<void>;
  getPendingWater(): Promise<LocalWater[]>;
  replaceSyncedWater(date: string, water: ServerWater[]): Promise<void>;

  /**
   * AC-mobile-004-07 y 08: borra los datos de la cuenta (rutina, equipo, registros, cola de pesos, umbral y de quién son).
   * Conserva el tema y el catálogo.
   */
  clearUserData(): Promise<void>;
  /** Cambios sin enviar de la cuenta actual: días, equipo, registros, umbral y pesos pendientes (no los rechazados). */
  countPendingChanges(): Promise<number>;

  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
}

export interface RestrictionHit {
  exerciseId: string;
  exerciseName: string;
  zones: string[];
}

export type PutDayResult =
  | { kind: 'ok'; entries: LocalPlanEntry[] }
  | { kind: 'warnings'; hits: RestrictionHit[] } // 409: hay avisos, reenviar con confirmación
  | { kind: 'blocked'; hits: RestrictionHit[] } // 422: restricción en nivel bloqueo
  | { kind: 'rejected'; reason: string } // 400 o 409 por id en uso: no se reintenta
  | { kind: 'retry' }; // red, 5xx o 401

export type PutEquipmentResult =
  | { kind: 'ok' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'retry' };

export type PutLogResult =
  | { kind: 'ok' }
  | { kind: 'rejected'; reason: string } // 400, 404, 409 o 422: no se reintenta
  | { kind: 'retry' }; // red, 5xx o 401

/** Cliente de la API (HTTP en la app, simulado en las pruebas). */
/** Resumen semanal de entrenamiento que calcula la API (SPEC-training-006). */
export interface ServerTrainingWeek {
  weekStart: string;
  sessions: number;
  sets: number;
  volumeKg: number;
  partial: boolean;
}

export interface RemoteApi {
  /** SPEC-training-006: semanas de entrenamiento (null = sin conexión o error). Opcional: no todos los clientes lo ofrecen. */
  fetchTrainingWeekly?(weeks: number): Promise<ServerTrainingWeek[] | null>;
  fetchCatalog(): Promise<CatalogSection[] | null>; // null = sin conexión o error
  fetchPlan(): Promise<{ day: DayKey; entries: LocalPlanEntry[] }[] | null>;
  fetchEquipment(): Promise<EquipmentProfile | null | 'none'>; // 'none' = la persona aún no tiene perfil
  putDay(day: DayKey, entries: LocalPlanEntry[], confirmWarnings: boolean): Promise<PutDayResult>;
  putEquipment(profile: EquipmentProfile): Promise<PutEquipmentResult>;
  putLog(log: ServerExerciseLog): Promise<PutLogResult>;
  /** La API responde 204 aunque el registro no exista, así que solo puede salir bien o reintentarse. */
  deleteLog(id: string): Promise<'ok' | 'retry'>;
  fetchProfile(): Promise<LocalProfile | null | 'none'>; // null = sin conexión o error; 'none' = la cuenta no tiene perfil
  putProfile(profile: LocalProfile): Promise<PutLogResult>;
  fetchRestrictions(): Promise<RestrictionItem[] | null>;
  putRestriction(item: RestrictionItem): Promise<PutLogResult>;
  deleteRestriction(id: string): Promise<'ok' | 'retry'>;
  fetchHistory(exerciseId: string): Promise<ServerExerciseLog[] | null>; // null = sin conexión o error
  fetchTrainingSettings(): Promise<number | null>; // umbral de estancamiento
  putTrainingSettings(stagnationThreshold: number): Promise<PutLogResult>;
  imageUrl(path: string): string;
}

/** Alternativa para sustituir un ejercicio (SPEC-training-005). */
export interface SuggestionAlternative {
  exerciseId: string;
  name: string;
}

/** Sugerencia que calcula la API. `kind`: ejercicio-estancado, metodo, dia-omitido, recuperacion-corta, restriccion-revision o restriccion-choque. */
export interface Suggestion {
  key: string;
  kind: string;
  exerciseId: string | null;
  day: string | null;
  message: string;
  alternatives: SuggestionAlternative[] | null;
}

export type AcceptSuggestionResult = { kind: 'ok' } | { kind: 'rejected'; reason: string } | { kind: 'retry' };

/** Parte de la API de las sugerencias; aparte de RemoteApi porque necesita conexión y no tiene cola local. */
export interface SuggestionsApi {
  fetchSuggestions(): Promise<Suggestion[] | null>; // null = sin conexión o error
  acceptSuggestion(key: string, replacementExerciseId: string): Promise<AcceptSuggestionResult>;
  dismissSuggestion(key: string): Promise<'ok' | 'retry'>;
}

