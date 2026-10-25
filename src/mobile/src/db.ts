import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import type { LocalWeight, WeightStatus, WeightStore } from './sync';

const SCHEMA_VERSION = 1;

interface Row {
  id: string;
  weight_kg: number;
  measured_at: string;
  created_at: string;
  status: WeightStatus;
  error: string | null;
}

const toLocal = (r: Row): LocalWeight => ({
  id: r.id,
  weightKg: r.weight_kg,
  measuredAt: r.measured_at,
  createdAt: r.created_at,
  status: r.status,
  error: r.error,
});

export async function openStore(): Promise<WeightStore & {
  add(weightKg: number): Promise<LocalWeight>;
  listAll(): Promise<LocalWeight[]>;
}> {
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
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  return {
    // AC-mobile-001-01: solo escribe en SQLite; el UUID nace aquí y no cambia nunca.
    async add(weightKg) {
      const now = new Date().toISOString();
      const id = Crypto.randomUUID();
      await db.runAsync(
        `INSERT INTO weight_queue (id, weight_kg, measured_at, created_at, status) VALUES (?, ?, ?, ?, 'pending')`,
        id, weightKg, now, now,
      );
      return { id, weightKg, measuredAt: now, createdAt: now, status: 'pending', error: null };
    },
    async listAll() {
      const rows = await db.getAllAsync<Row>('SELECT * FROM weight_queue ORDER BY created_at DESC');
      return rows.map(toLocal);
    },
    async listPending() {
      const rows = await db.getAllAsync<Row>(
        `SELECT * FROM weight_queue WHERE status = 'pending' ORDER BY created_at ASC`,
      );
      return rows.map(toLocal);
    },
    async markSynced(id) {
      await db.runAsync(`UPDATE weight_queue SET status = 'synced', error = NULL WHERE id = ?`, id);
    },
    async markRejected(id, reason) {
      await db.runAsync(`UPDATE weight_queue SET status = 'rejected', error = ? WHERE id = ?`, reason, id);
    },
  };
}
