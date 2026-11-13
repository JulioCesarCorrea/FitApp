import { getDb } from '../database';
import {
  DAYS,
  type CatalogSection,
  type DayKey,
  type DayState,
  type EquipmentProfile,
  type EquipmentState,
  type LocalExerciseLog,
  type LocalFood,
  type LocalFoodEntry,
  type LocalPlanEntry,
  type LocalProfile,
  type LocalStore,
  type ProfileState,
  type ServerExerciseLog,
  type ServerFood,
  type ServerFoodEntry,
  type SyncStatus,
} from './types';

interface StateRow { day: DayKey; status: SyncStatus; message: string | null }
interface EntryRow { id: string; day: DayKey; exercise_id: string; position: number; machine_step_kg: number | null }

/** Almacén local de la rutina, el catálogo y los ajustes en SQLite (P2: funciona sin conexión). */
export class SqliteStore implements LocalStore {
  async getCatalog(): Promise<CatalogSection[] | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM catalog_cache WHERE id = 1');
    return row ? (JSON.parse(row.json) as CatalogSection[]) : null;
  }

  async saveCatalog(sections: CatalogSection[]): Promise<void> {
    const db = await getDb();
    await db.runAsync('INSERT OR REPLACE INTO catalog_cache (id, json) VALUES (1, ?)', JSON.stringify(sections));
  }

  async getDays(): Promise<DayState[]> {
    const db = await getDb();
    const states = await db.getAllAsync<StateRow>('SELECT day, status, message FROM plan_day_state');
    const entries = await db.getAllAsync<EntryRow>('SELECT * FROM plan_entries_local ORDER BY position ASC');

    return DAYS.flatMap((day) => {
      const state = states.find((s) => s.day === day);
      if (!state) return [];
      const own = entries.filter((e) => e.day === day).map(toEntry);
      return [{ day, status: state.status, message: state.message, entries: own }];
    });
  }

  async saveDay(day: DayKey, entries: LocalPlanEntry[]): Promise<void> {
    await this.writeDay(day, entries, 'pending');
  }

  async replaceDaySynced(day: DayKey, entries: LocalPlanEntry[]): Promise<void> {
    if (entries.length === 0) {
      const db = await getDb();
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM plan_entries_local WHERE day = ?', day);
        await db.runAsync('DELETE FROM plan_day_state WHERE day = ?', day);
      });
      return;
    }
    await this.writeDay(day, entries, 'synced');
  }

  async setDayStatus(day: DayKey, status: SyncStatus, message: string | null): Promise<void> {
    const db = await getDb();
    await db.runAsync('UPDATE plan_day_state SET status = ?, message = ? WHERE day = ?', status, message, day);
  }

  async getEquipment(): Promise<EquipmentState> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ json: string; status: SyncStatus; message: string | null }>(
      'SELECT json, status, message FROM equipment_local WHERE id = 1',
    );
    return row
      ? { profile: JSON.parse(row.json) as EquipmentProfile, status: row.status, message: row.message }
      : { profile: null, status: 'synced', message: null };
  }

  async saveEquipment(profile: EquipmentProfile): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO equipment_local (id, json, status, message) VALUES (1, ?, 'pending', NULL)`,
      JSON.stringify(profile),
    );
  }

  async setEquipmentStatus(status: SyncStatus, message: string | null): Promise<void> {
    const db = await getDb();
    await db.runAsync('UPDATE equipment_local SET status = ?, message = ? WHERE id = 1', status, message);
  }

  async getLog(id: string): Promise<LocalExerciseLog | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<LogRow>('SELECT * FROM exercise_logs_local WHERE id = ?', id);
    return row ? toLog(row) : null;
  }

  async getLogs(exerciseId: string): Promise<LocalExerciseLog[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<LogRow>(
      'SELECT * FROM exercise_logs_local WHERE exercise_id = ? ORDER BY date ASC', exerciseId,
    );
    return rows.map(toLog);
  }

  async getPendingLogs(): Promise<LocalExerciseLog[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<LogRow>(
      `SELECT * FROM exercise_logs_local WHERE pending_op IS NOT NULL AND status = 'pending' ORDER BY date ASC`,
    );
    return rows.map(toLog);
  }

  async saveLog(log: LocalExerciseLog): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO exercise_logs_local
         (id, exercise_id, date, load_kg, first_set_reps, second_set_reps, second_set_assisted_reps,
          status, message, pending_op, attempted, methodology, reps_per_set)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      log.id, log.exerciseId, log.date, log.loadKg, log.firstSetReps, log.secondSetReps, log.secondSetAssistedReps,
      log.status, log.message, log.pendingOp, log.attempted ? 1 : 0,
      log.methodology ?? 'heavy_duty_personalizado', log.repsPerSet ? JSON.stringify(log.repsPerSet) : null,
    );
  }

  async deleteLog(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM exercise_logs_local WHERE id = ?', id);
  }

  async replaceSyncedLogs(exerciseId: string, logs: ServerExerciseLog[]): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM exercise_logs_local WHERE exercise_id = ?', exerciseId);
      for (const l of logs) {
        await db.runAsync(
          `INSERT INTO exercise_logs_local
             (id, exercise_id, date, load_kg, first_set_reps, second_set_reps, second_set_assisted_reps,
              status, message, pending_op, attempted, methodology, reps_per_set)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', NULL, NULL, 1, ?, ?)`,
          l.id, l.exerciseId, l.date, l.loadKg, l.firstSetReps, l.secondSetReps, l.secondSetAssistedReps,
          l.methodology ?? 'heavy_duty_personalizado', l.repsPerSet ? JSON.stringify(l.repsPerSet) : null,
        );
      }
    });
  }

  async getProfile(): Promise<ProfileState> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ json: string; status: SyncStatus; message: string | null }>(
      'SELECT json, status, message FROM profile_local WHERE id = 1',
    );
    return row
      ? { profile: JSON.parse(row.json) as LocalProfile, status: row.status, message: row.message }
      : { profile: null, status: 'synced', message: null };
  }

  async saveProfile(profile: LocalProfile): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO profile_local (id, json, status, message) VALUES (1, ?, 'pending', NULL)`,
      JSON.stringify(profile),
    );
  }

  async setProfileStatus(status: SyncStatus, message: string | null): Promise<void> {
    const db = await getDb();
    await db.runAsync('UPDATE profile_local SET status = ?, message = ? WHERE id = 1', status, message);
  }

  async getFoods(): Promise<LocalFood[]> {
    const db = await getDb();
    return (await db.getAllAsync<FoodRow>('SELECT * FROM foods_local ORDER BY name COLLATE NOCASE')).map(toFood);
  }

  async getFood(id: string): Promise<LocalFood | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<FoodRow>('SELECT * FROM foods_local WHERE id = ?', id);
    return row ? toFood(row) : null;
  }

  async saveFood(f: LocalFood): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO foods_local
         (id, name, brand, barcode, kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, source,
          status, message, pending_op, attempted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      f.id, f.name, f.brand, f.barcode, f.kcalPer100g, f.proteinPer100g, f.fatPer100g, f.carbsPer100g, f.source,
      f.status, f.message, f.pendingOp, f.attempted ? 1 : 0,
    );
  }

  async deleteFood(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM foods_local WHERE id = ?', id);
  }

  async replaceSyncedFoods(foods: ServerFood[]): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM foods_local WHERE pending_op IS NULL AND status = 'synced'`);
      for (const f of foods) {
        // INSERT OR IGNORE: lo que espera envío (misma id) manda sobre el servidor.
        await db.runAsync(
          `INSERT OR IGNORE INTO foods_local
             (id, name, brand, barcode, kcal_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, source,
              status, message, pending_op, attempted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL, NULL, 1)`,
          f.id, f.name, f.brand, f.barcode, f.kcalPer100g, f.proteinPer100g, f.fatPer100g, f.carbsPer100g, f.source,
        );
      }
    });
  }

  async getFoodEntries(date: string): Promise<LocalFoodEntry[]> {
    const db = await getDb();
    return (await db.getAllAsync<EntryRow>('SELECT * FROM food_entries_local WHERE date = ?', date)).map(toEntryRow);
  }

  async getFoodEntry(id: string): Promise<LocalFoodEntry | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<EntryRow>('SELECT * FROM food_entries_local WHERE id = ?', id);
    return row ? toEntryRow(row) : null;
  }

  async saveFoodEntry(e: LocalFoodEntry): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT OR REPLACE INTO food_entries_local
         (id, date, meal, food_id, grams, name, kcal, protein_g, fat_g, carbs_g, status, message, pending_op, attempted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      e.id, e.date, e.meal, e.foodId, e.grams, e.name, e.kcal, e.proteinG, e.fatG, e.carbsG,
      e.status, e.message, e.pendingOp, e.attempted ? 1 : 0,
    );
  }

  async deleteFoodEntry(id: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('DELETE FROM food_entries_local WHERE id = ?', id);
  }

  async getPendingNutrition(): Promise<{ foods: LocalFood[]; entries: LocalFoodEntry[] }> {
    const db = await getDb();
    const where = `WHERE pending_op IS NOT NULL AND status = 'pending'`;
    return {
      foods: (await db.getAllAsync<FoodRow>(`SELECT * FROM foods_local ${where}`)).map(toFood),
      entries: (await db.getAllAsync<EntryRow>(`SELECT * FROM food_entries_local ${where}`)).map(toEntryRow),
    };
  }

  async replaceSyncedFoodEntries(date: string, entries: ServerFoodEntry[]): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync(`DELETE FROM food_entries_local WHERE date = ? AND pending_op IS NULL AND status = 'synced'`, date);
      for (const e of entries) {
        await db.runAsync(
          `INSERT OR IGNORE INTO food_entries_local
             (id, date, meal, food_id, grams, name, kcal, protein_g, fat_g, carbs_g, status, message, pending_op, attempted)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', NULL, NULL, 1)`,
          e.id, e.date, e.meal, e.foodId, e.grams, e.name, e.kcal, e.proteinG, e.fatG, e.carbsG,
        );
      }
    });
  }

  async clearUserData(): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const table of [
        'plan_entries_local', 'plan_day_state', 'equipment_local', 'exercise_logs_local', 'profile_local', 'weight_queue',
        'foods_local', 'food_entries_local',
      ]) {
        await db.runAsync(`DELETE FROM ${table}`);
      }
      await db.runAsync(`DELETE FROM settings WHERE key LIKE 'stagnation%' OR key LIKE 'nutrition%' OR key = 'localUserId'`);
    });
  }

  async countPendingChanges(): Promise<number> {
    const db = await getDb();
    const count = async (sql: string) => (await db.getFirstAsync<{ n: number }>(sql))?.n ?? 0;
    return (
      (await count(`SELECT COUNT(*) AS n FROM plan_day_state WHERE status IN ('pending', 'needs_confirmation')`)) +
      (await count(`SELECT COUNT(*) AS n FROM equipment_local WHERE status = 'pending'`)) +
      (await count(`SELECT COUNT(*) AS n FROM profile_local WHERE status = 'pending'`)) +
      (await count(`SELECT COUNT(*) AS n FROM exercise_logs_local WHERE pending_op IS NOT NULL AND status = 'pending'`)) +
      (await count(`SELECT COUNT(*) AS n FROM foods_local WHERE pending_op IS NOT NULL AND status = 'pending'`)) +
      (await count(`SELECT COUNT(*) AS n FROM food_entries_local WHERE pending_op IS NOT NULL AND status = 'pending'`)) +
      (await count(`SELECT COUNT(*) AS n FROM settings WHERE key = 'stagnationThresholdStatus' AND value = 'pending'`)) +
      (await count(`SELECT COUNT(*) AS n FROM weight_queue WHERE status = 'pending'`))
    );
  }

  async getSetting(key: string): Promise<string | null> {
    const db = await getDb();
    return (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    const db = await getDb();
    await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
  }

  private async writeDay(day: DayKey, entries: LocalPlanEntry[], status: SyncStatus): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM plan_entries_local WHERE day = ?', day);
      for (const e of entries) {
        await db.runAsync(
          'INSERT INTO plan_entries_local (id, day, exercise_id, position, machine_step_kg) VALUES (?, ?, ?, ?, ?)',
          e.id, day, e.exerciseId, e.order, e.machineStepKg,
        );
      }
      await db.runAsync(
        'INSERT OR REPLACE INTO plan_day_state (day, status, message) VALUES (?, ?, NULL)',
        day, status,
      );
    });
  }
}

interface LogRow {
  id: string;
  exercise_id: string;
  date: string;
  load_kg: number;
  first_set_reps: number;
  second_set_reps: number;
  second_set_assisted_reps: number;
  status: SyncStatus;
  message: string | null;
  pending_op: 'upsert' | 'delete' | null;
  attempted: number;
  methodology: string | null;
  reps_per_set: string | null;
}

interface FoodRow {
  id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  kcal_per_100g: number;
  protein_per_100g: number;
  fat_per_100g: number;
  carbs_per_100g: number;
  source: 'manual' | 'openfoodfacts';
  status: SyncStatus;
  message: string | null;
  pending_op: 'upsert' | 'delete' | null;
  attempted: number;
}

interface EntryRow {
  id: string;
  date: string;
  meal: string;
  food_id: string | null;
  grams: number;
  name: string;
  kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  status: SyncStatus;
  message: string | null;
  pending_op: 'upsert' | 'delete' | null;
  attempted: number;
}

const toFood = (r: FoodRow): LocalFood => ({
  id: r.id, name: r.name, brand: r.brand, barcode: r.barcode, kcalPer100g: r.kcal_per_100g, proteinPer100g: r.protein_per_100g,
  fatPer100g: r.fat_per_100g, carbsPer100g: r.carbs_per_100g, source: r.source, status: r.status, message: r.message,
  pendingOp: r.pending_op, attempted: r.attempted === 1,
});

const toEntryRow = (r: EntryRow): LocalFoodEntry => ({
  id: r.id, date: r.date, meal: r.meal, foodId: r.food_id, grams: r.grams, name: r.name, kcal: r.kcal, proteinG: r.protein_g,
  fatG: r.fat_g, carbsG: r.carbs_g, status: r.status, message: r.message, pendingOp: r.pending_op, attempted: r.attempted === 1,
});

const toLog = (r: LogRow): LocalExerciseLog => ({
  id: r.id,
  exerciseId: r.exercise_id,
  date: r.date,
  loadKg: r.load_kg,
  firstSetReps: r.first_set_reps,
  secondSetReps: r.second_set_reps,
  secondSetAssistedReps: r.second_set_assisted_reps,
  status: r.status,
  message: r.message,
  pendingOp: r.pending_op,
  attempted: r.attempted === 1,
  methodology: r.methodology ?? 'heavy_duty_personalizado',
  repsPerSet: r.reps_per_set ? (JSON.parse(r.reps_per_set) as number[]) : null,
});

const toEntry = (r: EntryRow): LocalPlanEntry => ({
  id: r.id,
  exerciseId: r.exercise_id,
  order: r.position,
  machineStepKg: r.machine_step_kg,
});
