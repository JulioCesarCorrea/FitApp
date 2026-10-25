import * as SQLite from 'expo-sqlite';
import { migrate } from './migrations';

let opened: Promise<SQLite.SQLiteDatabase> | null = null;

/** Una sola conexión a fitness.db para toda la app, con sus migraciones aplicadas. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  opened ??= open();
  return opened;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync('fitness.db');
  await migrate(db);
  return db;
}
