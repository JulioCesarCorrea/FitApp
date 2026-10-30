// Migraciones de fitness.db. Sin dependencias de React Native: se prueban en Node con una base simulada.

export const SCHEMA_VERSION = 4;

/** Lo mínimo que necesitamos de expo-sqlite para migrar. */
export interface MigrationDb {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
}

// Todas las sentencias usan IF NOT EXISTS: la versión guardada puede estar por debajo de la real
// (por ejemplo, si una rama antigua de la app la dejó en 1), y entonces no debe fallar al repetirse.
const V1 = `
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS weight_queue (
    id TEXT PRIMARY KEY NOT NULL,
    weight_kg REAL NOT NULL,
    measured_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT
  );
`;

// SPEC-mobile-002: catálogo en caché, rutina local con estado por día, equipamiento y ajustes.
const V2 = `
  CREATE TABLE IF NOT EXISTS catalog_cache (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS plan_day_state (
    day TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL,
    message TEXT
  );
  CREATE TABLE IF NOT EXISTS plan_entries_local (
    id TEXT PRIMARY KEY NOT NULL,
    day TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    machine_step_kg REAL
  );
  CREATE TABLE IF NOT EXISTS equipment_local (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    json TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  );
`;

// SPEC-mobile-003: registros de sesiones con su estado de envío. `attempted` recuerda si ya se intentó enviar.
const V3 = `
  CREATE TABLE IF NOT EXISTS exercise_logs_local (
    id TEXT PRIMARY KEY NOT NULL,
    exercise_id TEXT NOT NULL,
    date TEXT NOT NULL,
    load_kg REAL NOT NULL,
    first_set_reps INTEGER NOT NULL,
    second_set_reps INTEGER NOT NULL,
    second_set_assisted_reps INTEGER NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    pending_op TEXT,
    attempted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_exercise_logs_local_exercise ON exercise_logs_local (exercise_id, date);
`;

// SPEC-profile-001: perfil de la persona (JSON) con su estado de envío.
const V4 = `
  CREATE TABLE IF NOT EXISTS profile_local (
    id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
    json TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT
  );
`;

export async function migrate(db: MigrationDb): Promise<void> {
  const current = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;

  if (current < 1) await db.execAsync(V1);
  if (current < 2) await db.execAsync(V2);
  if (current < 3) await db.execAsync(V3);
  if (current < 4) await db.execAsync(V4);

  // Nunca se baja la versión: solo se sube cuando se aplicó algo.
  if (current < SCHEMA_VERSION) await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
