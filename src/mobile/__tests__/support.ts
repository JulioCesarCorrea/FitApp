import { AuthService, MemoryTokenStore, type AuthRemote, type AuthResult, type StoredSession } from '../src/data/authService';
import { MemoryScheduler } from '../src/data/memoryScheduler';
import { MemoryStore } from '../src/data/memoryStore';
import { ReminderService } from '../src/data/reminderService';
import type { LocalWeight } from '../src/sync';
import { ProfileService } from '../src/data/profileService';
import { RestrictionService } from '../src/data/restrictionService';
import { PlanService } from '../src/data/planService';
import { SessionService } from '../src/data/sessionService';
import { NutritionService } from '../src/data/nutritionService';
import { portionOf, recipeTotal, scaleRecipe } from '../src/data/nutritionRules';
import { SuggestionService } from '../src/data/suggestionService';
import type {
  CatalogSection, DayKey, EquipmentProfile, LocalPlanEntry, LocalProfile, PutDayResult, PutEquipmentResult, PutLogResult,
  AcceptSuggestionResult, NutritionApi, ProductLookup, ProductLookupResult, RemoteApi, RestrictionItem, ServerFood, ServerFoodEntry, ServerNutritionHistory, ServerRecipe, ServerTrainingWeek, ServerWater,
  Suggestion, SuggestionsApi, TargetsResponse,
} from '../src/data/types';

export const CATALOG: CatalogSection[] = [
  {
    name: 'Pecho',
    exercises: [
      { id: 'press-plano-con-barra', name: 'Press plano con barra', primaryZone: 'pecho', secondaryZones: [], movements: [], equipment: 'Barra', bar: 'Recta', images: ['/exercise-images/press-plano-con-barra-0.jpg', '/exercise-images/press-plano-con-barra-1.jpg'] },
      { id: 'press-de-pecho-en-maquina', name: 'Press de pecho en máquina', primaryZone: 'pecho', secondaryZones: [], movements: [], equipment: 'Maquina', bar: null, images: ['/exercise-images/press-de-pecho-en-maquina-0.jpg'] },
    ],
  },
  {
    name: 'Hombros',
    exercises: [
      { id: 'elevaciones-laterales-con-mancuernas', name: 'Elevaciones laterales con mancuernas', primaryZone: 'hombro_lateral', secondaryZones: [], movements: [], equipment: 'Mancuernas', bar: null, images: ['/exercise-images/elevaciones-laterales-con-mancuernas-0.jpg'] },
    ],
  },
];

export const PROFILE: EquipmentProfile = {
  dumbbellsKg: [20, 22.5], barsKg: { recta: 20 }, discsKg: [2.5, 5], machineStepKg: 5, machineBaseKg: 0,
};

/** Objetivo de ejemplo que «calcula el servidor» (SPEC-nutrition-001). */
export const TARGETS: TargetsResponse = {
  kind: 'ok',
  target: {
    calories: 2500, proteinG: 145, fatG: 69, carbsG: 321, basalKcal: 1800, weightKg: 80.5, weightDate: '2026-11-12',
    calculatedCalories: 2500, source: 'calculated',
  },
};

export interface FakeRemote extends RemoteApi, SuggestionsApi, NutritionApi {
  online: boolean;
  /** Nutrición: lo que «tiene el servidor» y cómo responde. */
  serverFoods: ServerFood[];
  serverEntries: ServerFoodEntry[];
  targets: TargetsResponse;
  /** SPEC-nutrition-004: el agua que «tiene el servidor» y sus llamadas. */
  serverWater: ServerWater[];
  /** SPEC-nutrition-005: las recetas que «tiene el servidor». */
  serverRecipes: ServerRecipe[];
  /** SPEC-nutrition-006: lo que responde el historial del servidor (null = no responde). */
  serverHistory: ServerNutritionHistory | null;
  /** SPEC-training-006: lo que responde el resumen semanal del servidor (null = no responde). */
  serverTrainingWeeks: ServerTrainingWeek[] | null;
  /** SPEC-nutrition-002: ajustes recibidos y borrados del ajuste. */
  overridePuts: number[];
  overrideDeletes: number;
  foodResult: PutLogResult | null;
  entryResult: PutLogResult | null;
  entryPuts: string[];
  /** Sugerencias que «calcula el servidor» (SPEC-training-005). */
  serverSuggestions: Suggestion[];
  /** Si no es null, aceptar responde esto en lugar de aplicar el cambio. */
  acceptResult: AcceptSuggestionResult | null;
  accepted: { key: string; replacement: string }[];
  dismissed: string[];
  sent: { day: DayKey; entries: LocalPlanEntry[]; confirm: boolean }[];
  dayResult: (day: DayKey, confirm: boolean) => PutDayResult;
  equipmentResult: PutEquipmentResult;
  /** Perfil que «tiene el servidor»; null = la cuenta aún no tiene perfil (verá el asistente). */
  serverProfile: LocalProfile | null;
  putProfileResult: PutLogResult | null;
  serverRestrictions: RestrictionItem[];
  restrictionResult: PutLogResult | null;
}

export interface FakeAuthRemote extends AuthRemote {
  online: boolean;
  calls: string[];
  accounts: Map<string, { id: string; password: string; mustChange: boolean }>;
  locked: boolean;
  inviteCode: string;
}

/** Servidor de cuentas simulado (SPEC-auth-001): lo justo para recorrer las pantallas. */
function createAuthRemote(): FakeAuthRemote {
  let n = 0;
  const r: FakeAuthRemote = {
    online: true,
    calls: [],
    locked: false,
    inviteCode: 'codigo-bueno',
    accounts: new Map([
      ['julio', { id: 'user-1', password: 'contraseña-segura-1', mustChange: false }],
      ['ana', { id: 'user-2', password: 'otra-contraseña-9', mustChange: false }],
    ]),
    register: async (username, password, inviteCode) => {
      if (!r.online) return { kind: 'network' };
      r.calls.push(`register:${username}`);
      if (inviteCode !== r.inviteCode) return { kind: 'rejected', status: 403, reason: 'El código de invitación no es válido.' };
      if (r.accounts.has(username)) return { kind: 'rejected', status: 409, reason: 'Ese nombre de usuario ya está en uso.' };
      r.accounts.set(username, { id: `id-${username}`, password, mustChange: false });
      return issue(username);
    },
    login: async (username, password) => {
      if (!r.online) return { kind: 'network' };
      r.calls.push(`login:${username}`);
      if (r.locked) return { kind: 'locked', retryAfterSeconds: 600 };
      const account = r.accounts.get(username);
      if (!account || account.password !== password) return { kind: 'rejected', status: 401, reason: 'Usuario o contraseña incorrectos.' };
      return issue(username);
    },
    refresh: async () => (r.online ? { kind: 'rejected', status: 401, reason: 'La sesión ya no es válida. Entra de nuevo.' } : { kind: 'network' }),
    logout: async () => {
      r.calls.push('logout');
    },
    changePassword: async (_token, current, next) => {
      if (!r.online) return { kind: 'network' };
      const entry = [...r.accounts].find(([, a]) => a.password === current);
      if (!entry) return { kind: 'rejected', status: 400, reason: 'La contraseña actual no es correcta.' };
      entry[1].password = next;
      entry[1].mustChange = false;
      return issue(entry[0]);
    },
  };

  function issue(username: string): AuthResult {
    n++;
    const account = r.accounts.get(username)!;
    return {
      kind: 'ok',
      body: {
        accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresIn: 3600,
        user: { id: account.id, username, mustChangePassword: account.mustChange },
      },
    };
  }

  return r;
}

export const PROFILE_DATA: LocalProfile = {
  displayName: 'Julio', sex: 'masculino', birthDate: '1995-05-20', heightCm: 178, goal: 'ganar_musculo',
  activityLevel: 'ligero', experienceLevel: null, daysPerWeek: null, methodology: 'heavy_duty_personalizado', allergies: [],
};

export const SESSION: StoredSession = {
  accessToken: 'access-0', refreshToken: 'refresh-0', expiresAt: Date.now() + 3600 * 1000,
  user: { id: 'user-1', username: 'julio', mustChangePassword: false },
};

/** `signedIn: false` deja el teléfono sin sesión; por defecto las pruebas arrancan con la sesión de «julio» ya iniciada. */
export function createFakes(
  options: { signedIn?: boolean; session?: StoredSession; withProfile?: boolean; serverProfile?: 'none' } = {},
) {
  let n = 0;
  const store = new MemoryStore();
  // Lo que «tiene el servidor»: las pruebas lo siembran con seedServer y putDay lo actualiza.
  const server = new Map<DayKey, LocalPlanEntry[]>();
  const remote: FakeRemote = {
    online: true,
    sent: [],
    serverFoods: [],
    serverEntries: [],
    targets: TARGETS,
    serverWater: [],
    serverRecipes: [],
    serverHistory: null,
    serverTrainingWeeks: null,
    overridePuts: [],
    overrideDeletes: 0,
    foodResult: null,
    entryResult: null,
    entryPuts: [],
    serverSuggestions: [],
    acceptResult: null,
    accepted: [],
    dismissed: [],
    equipmentResult: { kind: 'ok' },
    dayResult: () => ({ kind: 'ok', entries: [] }),
    serverProfile: options.serverProfile === 'none' ? null : PROFILE_DATA,
    putProfileResult: null,
    serverRestrictions: [],
    restrictionResult: null,
    fetchProfile: async () => (remote.online ? (remote.serverProfile ?? 'none') : null),
    putProfile: async (p) => {
      if (!remote.online) return { kind: 'retry' };
      if (remote.putProfileResult) return remote.putProfileResult;
      remote.serverProfile = p;
      return { kind: 'ok' };
    },
    fetchRestrictions: async () => (remote.online ? [...remote.serverRestrictions] : null),
    putRestriction: async (item) => {
      if (!remote.online) return { kind: 'retry' };
      if (remote.restrictionResult) return remote.restrictionResult;
      remote.serverRestrictions = [...remote.serverRestrictions.filter((r) => r.id !== item.id), item];
      return { kind: 'ok' };
    },
    deleteRestriction: async (id) => {
      if (!remote.online) return 'retry';
      remote.serverRestrictions = remote.serverRestrictions.filter((r) => r.id !== id);
      return 'ok';
    },
    fetchTargets: async () => (remote.online ? remote.targets : null),
    putTargetOverride: async (calories) => {
      if (!remote.online) return { kind: 'retry' };
      remote.overridePuts.push(calories);
      // El «servidor» responde con las calorías ajustadas y los macros que recibió la app en su objetivo de prueba.
      if (remote.targets.kind === 'ok') remote.targets = { kind: 'ok', target: { ...remote.targets.target, calories, source: 'manual' } };
      return { kind: 'ok' };
    },
    deleteTargetOverride: async () => {
      if (!remote.online) return 'retry';
      remote.overrideDeletes += 1;
      if (remote.targets.kind === 'ok') {
        const t = remote.targets.target;
        remote.targets = { kind: 'ok', target: { ...t, calories: t.calculatedCalories, source: 'calculated' } };
      }
      return 'ok';
    },
    fetchFoods: async () => (remote.online ? [...remote.serverFoods] : null),
    putFood: async (food) => {
      if (!remote.online) return { kind: 'retry' };
      if (remote.foodResult) return remote.foodResult;
      remote.serverFoods = [...remote.serverFoods.filter((f) => f.id !== food.id), food];
      return { kind: 'ok' };
    },
    deleteFood: async (id) => {
      if (!remote.online) return 'retry';
      remote.serverFoods = remote.serverFoods.filter((f) => f.id !== id);
      return 'ok';
    },
    fetchDayEntries: async (date) => (remote.online ? remote.serverEntries.filter((e) => e.date === date) : null),
    putFoodEntry: async (entry) => {
      if (!remote.online) return { kind: 'retry' };
      if (remote.entryResult) return remote.entryResult;
      if (entry.recipeId) {
        const recipe = remote.serverRecipes.find((r) => r.id === entry.recipeId);
        if (!recipe) return { kind: 'rejected', reason: 'La receta no existe en tu lista.' };
        remote.entryPuts.push(entry.id);
        const eaten = scaleRecipe(recipeTotal(recipe.ingredients), recipe.servings, entry.servings ?? 1);
        remote.serverEntries = [
          ...remote.serverEntries.filter((e) => e.id !== entry.id),
          { ...entry, name: recipe.name, kcal: eaten.kcal, proteinG: eaten.proteinG, fatG: eaten.fatG, carbsG: eaten.carbsG,
            fiberG: eaten.fiberG, sugarsG: eaten.sugarsG, sodiumMg: eaten.sodiumMg },
        ];
        return { kind: 'ok' };
      }
      const food = remote.serverFoods.find((f) => f.id === entry.foodId);
      if (!food) return { kind: 'rejected', reason: 'El alimento no existe en tu lista.' };
      remote.entryPuts.push(entry.id);
      const portion = portionOf(food.kcalPer100g, food.proteinPer100g, food.fatPer100g, food.carbsPer100g, entry.grams);
      remote.serverEntries = [...remote.serverEntries.filter((e) => e.id !== entry.id), { ...entry, name: food.name, ...portion, fiberG: null, sugarsG: null, sodiumMg: null }];
      return { kind: 'ok' };
    },
    deleteFoodEntry: async (id) => {
      if (!remote.online) return 'retry';
      remote.serverEntries = remote.serverEntries.filter((e) => e.id !== id);
      return 'ok';
    },
    fetchTrainingWeekly: async () => (remote.online ? remote.serverTrainingWeeks : null),
    fetchNutritionHistory: async () => (remote.online ? remote.serverHistory : null),
    fetchRecipes: async () => (remote.online ? remote.serverRecipes.map((r) => structuredClone(r)) : null),
    putRecipe: async (recipe) => {
      if (!remote.online) return { kind: 'retry' };
      remote.serverRecipes = [...remote.serverRecipes.filter((r) => r.id !== recipe.id), structuredClone(recipe)];
      return { kind: 'ok' };
    },
    deleteRecipe: async (id) => {
      if (!remote.online) return 'retry';
      remote.serverRecipes = remote.serverRecipes.filter((r) => r.id !== id);
      return 'ok';
    },
    fetchDayWater: async (date) => (remote.online ? remote.serverWater.filter((w) => w.date === date) : null),
    putWaterEntry: async (water) => {
      if (!remote.online) return { kind: 'retry' };
      remote.serverWater = [...remote.serverWater.filter((w) => w.id !== water.id), water];
      return { kind: 'ok' };
    },
    deleteWaterEntry: async (id) => {
      if (!remote.online) return 'retry';
      remote.serverWater = remote.serverWater.filter((w) => w.id !== id);
      return 'ok';
    },
    fetchSuggestions: async () => (remote.online ? [...remote.serverSuggestions] : null),
    acceptSuggestion: async (key, replacement) => {
      if (!remote.online) return { kind: 'retry' };
      if (remote.acceptResult) return remote.acceptResult;
      const suggestion = remote.serverSuggestions.find((s) => s.key === key);
      if (!suggestion?.day) return { kind: 'rejected', reason: 'La sugerencia ya no existe.' };
      // Sustituye el ejercicio en la rutina del servidor, en el mismo día y la misma posición.
      const day = suggestion.day as DayKey;
      server.set(day, (server.get(day) ?? []).map((e) => (e.exerciseId === suggestion.exerciseId ? { ...e, exerciseId: replacement } : e)));
      remote.accepted.push({ key, replacement });
      remote.serverSuggestions = remote.serverSuggestions.filter((s) => s.key !== key);
      return { kind: 'ok' };
    },
    dismissSuggestion: async (key) => {
      if (!remote.online) return 'retry';
      remote.dismissed.push(key);
      remote.serverSuggestions = remote.serverSuggestions.filter((s) => s.key !== key);
      return 'ok';
    },
    putLog: async () => ({ kind: 'retry' }),
    deleteLog: async () => 'retry',
    fetchHistory: async () => null,
    fetchTrainingSettings: async () => null,
    putTrainingSettings: async () => ({ kind: 'retry' }),
    fetchCatalog: async () => (remote.online ? CATALOG : null),
    fetchPlan: async () =>
      remote.online ? [...server.entries()].filter(([, e]) => e.length > 0).map(([day, entries]) => ({ day, entries })) : null,
    fetchEquipment: async () => (remote.online ? 'none' : null),
    putDay: async (day, entries, confirm) => {
      if (!remote.online) return { kind: 'retry' };
      remote.sent.push({ day, entries, confirm });
      const result = remote.dayResult(day, confirm);
      if (result.kind === 'ok') server.set(day, entries);
      return result;
    },
    putEquipment: async () => (remote.online ? remote.equipmentResult : { kind: 'retry' }),
    imageUrl: (path) => `http://api.test${path}`,
  };
  const service = new PlanService(store, remote, () => `id-${++n}`);
  const sessions = new SessionService(store, remote, () => `log-${++n}`, () => '2026-10-30');
  const scheduler = new MemoryScheduler();
  const weightsAdded: number[] = [];
  const weights: { rows: LocalWeight[]; list: () => Promise<LocalWeight[]> } = { rows: [], list: async () => [...weights.rows] };
  const profile = new ProfileService(store, remote, async (kg) => {
    weightsAdded.push(kg);
  });
  const restrictions = new RestrictionService(remote, () => `restriction-${++n}`, () => '2026-10-30');
  const suggestions = new SuggestionService(remote, service);
  const nutrition = new NutritionService(store, remote, () => `food-${++n}`);
  const reminders = new ReminderService(store, scheduler, () => weights.list(), () => true, () => new Date(2026, 10, 12, 10, 0, 0));
  const products: ProductLookup & { result: ProductLookupResult; lookups: string[] } = {
    result: { kind: 'notFound' },
    lookups: [],
    lookup: async (barcode) => {
      products.lookups.push(barcode);
      return products.result;
    },
  };
  const authRemote = createAuthRemote();
  const tokens = new MemoryTokenStore(options.signedIn === false ? null : (options.session ?? SESSION));
  const auth = new AuthService(tokens, authRemote, store);
  /** Deja una rutina ya sincronizada: en el servidor y en el teléfono. */
  const seedServer = async (day: DayKey, entries: LocalPlanEntry[]) => {
    server.set(day, entries);
    await store.replaceDaySynced(day, entries);
  };
  // Las pruebas que no son del asistente arrancan con un perfil ya hecho en el teléfono (sin él se vería el asistente).
  if (options.signedIn !== false && options.withProfile !== false) {
    void store.saveProfile(PROFILE_DATA).then(() => store.setProfileStatus('synced', null));
  }
  return {
    store, remote, service, sessions, auth, authRemote, tokens, profile, restrictions, suggestions, nutrition, products, weights, reminders, scheduler, weightsAdded, seedServer,
    deps: { store, remote, service, sessions, auth, profile, restrictions, suggestions, nutrition, weights, reminders, products },
  };
}
