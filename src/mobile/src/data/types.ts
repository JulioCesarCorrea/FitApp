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
  /** pending → synced | rejected. `needs_confirmation` no se usa en los registros. */
  status: SyncStatus;
  message: string | null;
  pendingOp: 'upsert' | 'delete' | null;
  attempted: boolean;
}

/** Lo que guarda el servidor de un registro (historial). */
export type ServerExerciseLog = Pick<
  LocalExerciseLog,
  'id' | 'exerciseId' | 'date' | 'loadKg' | 'firstSetReps' | 'secondSetReps' | 'secondSetAssistedReps'
>;

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
  saveLog(log: LocalExerciseLog): Promise<void>;
  deleteLog(id: string): Promise<void>;
  /** Sustituye todos los registros del ejercicio por lo que dice el servidor, ya sincronizados. */
  replaceSyncedLogs(exerciseId: string, logs: ServerExerciseLog[]): Promise<void>;

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
export interface RemoteApi {
  fetchCatalog(): Promise<CatalogSection[] | null>; // null = sin conexión o error
  fetchPlan(): Promise<{ day: DayKey; entries: LocalPlanEntry[] }[] | null>;
  fetchEquipment(): Promise<EquipmentProfile | null | 'none'>; // 'none' = la persona aún no tiene perfil
  putDay(day: DayKey, entries: LocalPlanEntry[], confirmWarnings: boolean): Promise<PutDayResult>;
  putEquipment(profile: EquipmentProfile): Promise<PutEquipmentResult>;
  putLog(log: ServerExerciseLog): Promise<PutLogResult>;
  /** La API responde 204 aunque el registro no exista, así que solo puede salir bien o reintentarse. */
  deleteLog(id: string): Promise<'ok' | 'retry'>;
  fetchHistory(exerciseId: string): Promise<ServerExerciseLog[] | null>; // null = sin conexión o error
  fetchTrainingSettings(): Promise<number | null>; // umbral de estancamiento
  putTrainingSettings(stagnationThreshold: number): Promise<PutLogResult>;
  imageUrl(path: string): string;
}
