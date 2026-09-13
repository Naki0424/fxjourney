import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closeDatabase, DEFAULT_DATABASE_PATH, openDatabase } from "./index.js";

const migrationsDirectory = fileURLToPath(new URL("./migrations", import.meta.url));

export function discoverMigrationFiles(directory = migrationsDirectory) {
  const migrations = fs.readdirSync(directory)
    .filter((filename) => /^(\d+)[-_].+\.sql$/i.test(filename))
    .map((filename) => {
      const match = filename.match(/^(\d+)[-_].+\.sql$/i);
      return {
        filename,
        version: match[1],
        filePath: path.join(directory, filename),
      };
    })
    .sort((left, right) => Number(left.version) - Number(right.version) || left.filename.localeCompare(right.filename));

  const seenVersions = new Set();
  for (const migration of migrations) {
    if (seenVersions.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    seenVersions.add(migration.version);
  }

  return migrations;
}

export function ensureMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    );
  `);
}

export function runMigrations(database, directory = migrationsDirectory) {
  ensureMigrationTable(database);

  const appliedVersions = new Set(
    database.prepare("SELECT version FROM schema_migrations ORDER BY version").pluck().all(),
  );
  const insertMigration = database.prepare(
    "INSERT INTO schema_migrations (version, appliedAt) VALUES (?, ?)",
  );
  const applied = [];
  const skipped = [];

  for (const migration of discoverMigrationFiles(directory)) {
    if (appliedVersions.has(migration.version)) {
      skipped.push(migration.version);
      continue;
    }

    const sql = fs.readFileSync(migration.filePath, "utf8");
    database.transaction(() => {
      database.exec(sql);
      insertMigration.run(migration.version, new Date().toISOString());
    })();
    applied.push(migration.version);
  }

  return { applied, skipped };
}

export function migrateDatabase({
  filename = process.env.FXJOURNEY_DB_PATH || DEFAULT_DATABASE_PATH,
  wal = true,
  directory = migrationsDirectory,
} = {}) {
  const database = openDatabase({ filename, wal });
  try {
    return {
      databasePath: filename === ":memory:" ? filename : path.resolve(filename),
      ...runMigrations(database, directory),
    };
  } finally {
    closeDatabase(database);
  }
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  try {
    const result = migrateDatabase();
    console.log(
      `SQLite migrations complete: applied [${result.applied.join(", ") || "none"}], skipped [${result.skipped.join(", ") || "none"}]`,
    );
    console.log(`Database: ${result.databasePath}`);
  } catch (error) {
    console.error(`SQLite migration failed: ${error.message}`);
    process.exitCode = 1;
  }
}
