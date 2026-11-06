import { getDb } from '../database';
import {
  DAYS,
  type CatalogSection,
  type DayKey,
  type DayState,
  type EquipmentProfile,
  type EquipmentState,
  type LocalExerciseLog,
  type LocalPlanEntry,
  type LocalProfile,
  type LocalStore,
  type ProfileState,
  type ServerExerciseLog,
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
          status, message, pending_op, attempted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      log.id, log.exerciseId, log.date, log.loadKg, log.firstSetReps, log.secondSetReps, log.secondSetAssistedReps,
      log.status, log.message, log.pendingOp, log.attempted ? 1 : 0,
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
              status, message, pending_op, attempted)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'synced', NULL, NULL, 1)`,
          l.id, l.exerciseId, l.date, l.loadKg, l.firstSetReps, l.secondSetReps, l.secondSetAssistedReps,
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

  async clearUserData(): Promise<void> {
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const table of ['plan_entries_local', 'plan_day_state', 'equipment_local', 'exercise_logs_local', 'profile_local', 'weight_queue']) {
        await db.runAsync(`DELETE FROM ${table}`);
      }
      await db.runAsync(`DELETE FROM settings WHERE key LIKE 'stagnation%' OR key = 'localUserId'`);
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
}

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
});

const toEntry = (r: EntryRow): LocalPlanEntry => ({
  id: r.id,
  exerciseId: r.exercise_id,
  order: r.position,
  machineStepKg: r.machine_step_kg,
});
