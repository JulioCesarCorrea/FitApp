import * as SQLite from 'expo-sqlite';

const SCHEMA_VERSION = 2;

let opened: Promise<SQLite.SQLiteDatabase> | null = null;

/** Una sola conexión a fitness.db para toda la app, con sus migraciones aplicadas. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  opened ??= open();
  return opened;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('fitness.db');
  const current = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;

  if (current < 1) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE weight_queue (
        id TEXT PRIMARY KEY NOT NULL,
        weight_kg REAL NOT NULL,
        measured_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT
      );
    `);
  }

  if (current < 2) {
    // SPEC-mobile-002: catálogo en caché, rutina local con estado por día, equipamiento y ajustes.
    await db.execAsync(`
      CREATE TABLE catalog_cache (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        json TEXT NOT NULL
      );
      CREATE TABLE plan_day_state (
        day TEXT PRIMARY KEY NOT NULL,
        status TEXT NOT NULL,
        message TEXT
      );
      CREATE TABLE plan_entries_local (
        id TEXT PRIMARY KEY NOT NULL,
        day TEXT NOT NULL,
        exercise_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        machine_step_kg REAL
      );
      CREATE TABLE equipment_local (
        id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
        json TEXT NOT NULL,
        status TEXT NOT NULL,
        message TEXT
      );
      CREATE TABLE settings (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
  }

  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}
