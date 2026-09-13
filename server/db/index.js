import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const defaultDatabasePath = fileURLToPath(new URL("../data/fxjourney.db", import.meta.url));

export const DEFAULT_DATABASE_PATH = defaultDatabasePath;

export function resolveDatabasePath(filename = process.env.FXJOURNEY_DB_PATH || DEFAULT_DATABASE_PATH) {
  return filename === ":memory:" ? filename : path.resolve(filename);
}

export function openDatabase({
  filename = process.env.FXJOURNEY_DB_PATH || DEFAULT_DATABASE_PATH,
  wal = true,
} = {}) {
  const databasePath = resolveDatabasePath(filename);

  if (databasePath !== ":memory:") {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }

  const database = new Database(databasePath);
  database.pragma("foreign_keys = ON");

  if (wal && databasePath !== ":memory:") {
    database.pragma("journal_mode = WAL");
  }

  return database;
}

export function closeDatabase(database) {
  if (database?.open) {
    database.close();
  }
}
