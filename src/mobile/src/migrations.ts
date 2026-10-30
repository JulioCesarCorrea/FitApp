// Migraciones de fitness.db. Sin dependencias de React Native: se prueban en Node con una base simulada.

export const SCHEMA_VERSION = 2;

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

export async function migrate(db: MigrationDb): Promise<void> {
  const current = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;

  if (current < 1) await db.execAsync(V1);
  if (current < 2) await db.execAsync(V2);

  // Nunca se baja la versión: solo se sube cuando se aplicó algo.
  if (current < SCHEMA_VERSION) await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
