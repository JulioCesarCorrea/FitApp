import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION, type MigrationDb } from './migrations';

/** Base simulada: recuerda las tablas y falla como SQLite si se crea una que ya existe sin IF NOT EXISTS. */
function fakeDb(version: number, tables: string[] = []) {
  const state = { version, tables: new Set(tables), executed: [] as string[] };

  const db: MigrationDb = {
    getFirstAsync: async <T>() => ({ user_version: state.version }) as T,
    execAsync: async (sql) => {
      state.executed.push(sql);
      const pragma = /PRAGMA user_version = (\d+)/.exec(sql);
      if (pragma) state.version = Number(pragma[1]);
      for (const m of sql.matchAll(/CREATE TABLE (IF NOT EXISTS )?(\w+)/g)) {
        const [, ifNotExists, name] = m;
        if (state.tables.has(name) && !ifNotExists) throw new Error(`table ${name} already exists`);
        state.tables.add(name);
      }
    },
  };
  return { db, state };
}

describe('migraciones de fitness.db (SPEC-mobile-002)', () => {
  it('base nueva: crea todas las tablas y deja la versión actual', async () => {
    const { db, state } = fakeDb(0);

    await migrate(db);

    expect([...state.tables].sort()).toEqual([
      'catalog_cache', 'equipment_local', 'plan_day_state', 'plan_entries_local', 'settings', 'weight_queue',
    ]);
    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('base del spike (versión 1): añade solo lo nuevo', async () => {
    const { db, state } = fakeDb(1, ['weight_queue']);

    await migrate(db);

    expect(state.tables.has('catalog_cache')).toBe(true);
    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('versión 1 con las tablas nuevas ya creadas (una rama antigua bajó la versión): no falla', async () => {
    const { db, state } = fakeDb(1, ['weight_queue', 'catalog_cache', 'plan_day_state', 'plan_entries_local', 'equipment_local', 'settings']);

    await expect(migrate(db)).resolves.toBeUndefined();

    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('versión actual: no ejecuta nada', async () => {
    const { db, state } = fakeDb(SCHEMA_VERSION, ['weight_queue']);

    await migrate(db);

    expect(state.executed).toEqual([]);
  });

  it('nunca baja la versión si la base es de una versión más nueva', async () => {
    const { db, state } = fakeDb(SCHEMA_VERSION + 3);

    await migrate(db);

    expect(state.version).toBe(SCHEMA_VERSION + 3);
    expect(state.executed).toEqual([]);
  });

  it('repetir la migración es seguro', async () => {
    const { db, state } = fakeDb(0);

    await migrate(db);
    state.version = 1; // simula que otra versión de la app bajó el número
    await expect(migrate(db)).resolves.toBeUndefined();
  });
});
