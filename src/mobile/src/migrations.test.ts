import { describe, expect, it } from 'vitest';
import { migrate, SCHEMA_VERSION, type MigrationDb } from './migrations';

/** Base simulada: recuerda las tablas y falla como SQLite si se crea una que ya existe sin IF NOT EXISTS. */
function fakeDb(version: number, tables: string[] = [], columns: string[] = []) {
  const state = { version, tables: new Set(tables), columns: new Set(columns), executed: [] as string[] };

  const db: MigrationDb = {
    getFirstAsync: async <T>(sql: string) => {
      const column = /pragma_table_info\('(\w+)'\) WHERE name = '(\w+)'/.exec(sql);
      if (column) return { n: state.columns.has(column[2]) ? 1 : 0 } as T;
      return { user_version: state.version } as T;
    },
    execAsync: async (sql) => {
      state.executed.push(sql);
      const alter = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(sql);
      if (alter) {
        if (state.columns.has(alter[2])) throw new Error(`duplicate column name: ${alter[2]}`);
        state.columns.add(alter[2]);
      }
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

describe('migraciones de fitness.db (SPEC-mobile-002 y SPEC-mobile-003)', () => {
  it('base nueva: crea todas las tablas y deja la versión actual', async () => {
    const { db, state } = fakeDb(0);

    await migrate(db);

    expect([...state.tables].sort()).toEqual([
      'catalog_cache', 'equipment_local', 'exercise_logs_local', 'plan_day_state', 'plan_entries_local', 'profile_local',
      'settings', 'weight_queue',
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

  it('AC-mobile-003-03 base de la rutina (versión 2): añade solo la tabla de registros', async () => {
    const { db, state } = fakeDb(2, ['weight_queue', 'catalog_cache', 'plan_day_state', 'plan_entries_local', 'equipment_local', 'settings']);

    await migrate(db);

    expect(state.tables.has('exercise_logs_local')).toBe(true);
    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('versión 2 con la tabla de registros ya creada (una rama antigua bajó la versión): no falla', async () => {
    const { db, state } = fakeDb(2, ['exercise_logs_local']);

    await expect(migrate(db)).resolves.toBeUndefined();

    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('AC-profile-001-11 base con registros (versión 3): añade solo la tabla del perfil', async () => {
    const { db, state } = fakeDb(3, ['weight_queue', 'catalog_cache', 'plan_day_state', 'plan_entries_local', 'equipment_local', 'settings', 'exercise_logs_local']);

    await migrate(db);

    expect(state.tables.has('profile_local')).toBe(true);
    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('versión 3 con la tabla del perfil ya creada (una rama antigua bajó la versión): no falla', async () => {
    const { db, state } = fakeDb(3, ['profile_local']);

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

  it('AC-training-004-14 base con registros (versión 4): añade metodología y repeticiones por serie sin tocar los datos', async () => {
    const { db, state } = fakeDb(4, ['exercise_logs_local', 'profile_local']);

    await migrate(db);

    expect([...state.columns].sort()).toEqual(['methodology', 'reps_per_set']);
    expect(state.executed.some((sql) => /DROP|DELETE|UPDATE/i.test(sql))).toBe(false);
    expect(state.executed.find((sql) => sql.includes('methodology'))).toContain("DEFAULT 'heavy_duty_personalizado'");
    expect(state.version).toBe(SCHEMA_VERSION);
  });

  it('AC-training-004-14 con las columnas ya creadas (una rama antigua bajó la versión): no falla ni las repite', async () => {
    const { db, state } = fakeDb(4, ['exercise_logs_local'], ['methodology', 'reps_per_set']);

    await expect(migrate(db)).resolves.toBeUndefined();

    expect(state.executed.some((sql) => sql.includes('ALTER TABLE'))).toBe(false);
    expect(state.version).toBe(SCHEMA_VERSION);
  });
});
