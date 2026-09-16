import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { closeDatabase, openDatabase } from "./index.js";
import { runMigrations } from "./migrate.js";

const requiredTables = [
  "schema_migrations",
  "user_profiles",
  "devices",
  "accounts",
  "app_settings",
  "trades",
  "media_assets",
  "screenshot_folders",
  "categories",
  "tags",
  "trade_tags",
  "media_tags",
  "media_categories",
  "journal_entries",
  "journal_tags",
  "goals",
  "goal_milestones",
  "habits",
  "habit_entries",
  "weekly_reflections",
  "analysis_sessions",
  "analysis_session_media",
  "analysis_report_versions",
  "analysis_report_feedback",
  "sync_changes",
  "sync_state",
  "sync_conflicts",
  "sync_device_sequences",
  "sync_change_receipts",
  "sync_pending_changes",
  "sync_pairing_invitations",
  "sync_peers",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectRejected(operation, description) {
  try {
    operation();
  } catch {
    return;
  }
  throw new Error("Expected rejection: " + description);
}

function tableNames(database) {
  return database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).pluck().all();
}

function schemaSnapshot(database) {
  return database.prepare(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  ).all();
}

function columns(database, tableName) {
  return database.pragma("table_info('" + tableName + "')");
}

function columnNames(database, tableName) {
  return new Set(columns(database, tableName).map((column) => column.name));
}

function columnType(database, tableName, columnName) {
  const column = columns(database, tableName).find((entry) => entry.name === columnName);
  assert(column, "Missing column " + tableName + "." + columnName);
  return column.type.toUpperCase();
}

function indexCovers(database, tableName, expectedColumns, unique = false) {
  const indexes = database.pragma("index_list('" + tableName + "')");
  return indexes.some((index) => {
    if (unique && Number(index.unique) !== 1) {
      return false;
    }
    const indexedColumns = database
      .pragma("index_info('" + index.name + "')")
      .sort((left, right) => left.seqno - right.seqno)
      .map((column) => column.name);
    return expectedColumns.length === indexedColumns.length
      && expectedColumns.every((column, position) => indexedColumns[position] === column);
  });
}

function runVerification() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-schema-"));
  const databasePath = path.join(tempDirectory, "verification.db");
  const database = openDatabase({ filename: databasePath, wal: false });

  try {
    const firstRun = runMigrations(database);
    assert(JSON.stringify(firstRun.applied) === JSON.stringify(["001", "002", "003", "004"]), "Schema migrations were not applied in order on a fresh DB.");

    const tables = tableNames(database);
    assert(tables.length === requiredTables.length, "Expected " + requiredTables.length + " tables, found " + tables.length + ".");
    for (const table of requiredTables) {
      assert(tables.includes(table), "Missing required table: " + table);
    }

    const migrationRows = database.prepare("SELECT version, appliedAt FROM schema_migrations ORDER BY version").all();
    assert(JSON.stringify(migrationRows.map((row) => row.version)) === JSON.stringify(["001", "002", "003", "004"]), "schema_migrations does not contain all ordered migrations.");
    assert(migrationRows.every((row) => row.appliedAt), "schema_migrations contains an incomplete migration record.");

    assert(Number(database.pragma("foreign_keys", { simple: true })) === 1, "PRAGMA foreign_keys is not enabled.");

    const initialSnapshot = JSON.stringify(schemaSnapshot(database));
    const secondRun = runMigrations(database);
    assert(secondRun.applied.length === 0, "Rerunning migrations applied a migration.");
    assert(JSON.stringify(secondRun.skipped) === JSON.stringify(["001", "002", "003", "004"]), "Rerunning migrations did not skip all applied migrations.");
    assert(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count === 4, "Migration records were duplicated.");
    assert(JSON.stringify(schemaSnapshot(database)) === initialSnapshot, "Rerunning migrations changed the schema.");

    const now = "2026-09-13T00:00:00.000Z";
    const userId = randomUUID();
    const deviceId = randomUUID();
    const secondDeviceId = randomUUID();
    const accountId = randomUUID();
    const tagId = randomUUID();
    const habitId = randomUUID();
    const sessionId = randomUUID();
    const tradeId = randomUUID();

    database.prepare(
      "INSERT INTO user_profiles (id, displayName, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(userId, "Schema Verification User", now, now, deviceId, deviceId);

    database.prepare(
      "INSERT INTO devices (id, userId, name, platform, createdAt) VALUES (?, ?, ?, ?, ?)",
    ).run(deviceId, userId, "Verification Device", "TEST", now);
    database.prepare(
      "INSERT INTO devices (id, userId, name, platform, createdAt) VALUES (?, ?, ?, ?, ?)",
    ).run(secondDeviceId, userId, "Second Verification Device", "TEST", now);

    database.prepare(
      "INSERT INTO accounts (id, userId, name, currencyCode, currencyMinorDigits, initialBalanceMinor, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(accountId, userId, "Verification Account", "USD", 2, 1000000, now, now, deviceId, deviceId);

    const insertTrade = database.prepare(
      "INSERT INTO trades (id, userId, accountId, instrument, direction, status, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    expectRejected(
      () => insertTrade.run(randomUUID(), userId, accountId, "EURUSD", "INVALID", "OPEN", now, now, deviceId, deviceId),
      "invalid trade direction",
    );
    expectRejected(
      () => insertTrade.run(randomUUID(), userId, accountId, "EURUSD", "BUY", "INVALID", now, now, deviceId, deviceId),
      "invalid trade status",
    );
    insertTrade.run(tradeId, userId, accountId, "EURUSD", "BUY", "OPEN", now, now, deviceId, deviceId);

    const insertTag = database.prepare(
      "INSERT INTO tags (id, userId, name, normalizedName, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertTag.run(tagId, userId, "Breakout", "breakout", now, now, deviceId, deviceId);
    expectRejected(
      () => insertTag.run(randomUUID(), userId, "Breakout 2", "breakout", now, now, deviceId, deviceId),
      "duplicate active normalized tag",
    );

    database.prepare(
      "INSERT INTO habits (id, userId, name, frequency, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(habitId, userId, "Review plan", "DAILY", now, now, deviceId, deviceId);
    const insertHabitEntry = database.prepare(
      "INSERT INTO habit_entries (id, habitId, entryDate, status, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertHabitEntry.run(randomUUID(), habitId, "2026-09-13", "COMPLETED", now, now, deviceId, deviceId);
    expectRejected(
      () => insertHabitEntry.run(randomUUID(), habitId, "2026-09-13", "SKIPPED", now, now, deviceId, deviceId),
      "duplicate active habit entry",
    );

    database.prepare(
      "INSERT INTO analysis_sessions (id, userId, instrument, primaryTimeframe, status, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(sessionId, userId, "EURUSD", "15m", "ACTIVE", now, now, deviceId, deviceId);

    const mediaIds = [randomUUID(), randomUUID(), randomUUID()];
    const insertMedia = database.prepare(
      "INSERT INTO media_assets (id, userId, originalFilename, mimeType, byteSize, uploadedAt, storageKey, checksumSha256, source, availabilityStatus, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    mediaIds.forEach((mediaId, index) => {
      insertMedia.run(
        mediaId,
        userId,
        "chart-" + index + ".png",
        "image/png",
        100 + index,
        now,
        "verification/" + mediaId,
        "checksum-" + index,
        "UPLOAD",
        "AVAILABLE",
        now,
        now,
        deviceId,
        deviceId,
      );
    });

    const insertSessionMedia = database.prepare(
      "INSERT INTO analysis_session_media (id, sessionId, mediaId, timeframe, ordinal, addedAt, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertSessionMedia.run(randomUUID(), sessionId, mediaIds[0], "15m", 1, now, now, now, deviceId, deviceId);
    insertSessionMedia.run(randomUUID(), sessionId, mediaIds[1], "15m", 2, now, now, now, deviceId, deviceId);
    assert(
      database.prepare("SELECT COUNT(*) AS count FROM analysis_session_media WHERE sessionId = ?").get(sessionId).count === 2,
      "Multiple screenshots from the same timeframe were not allowed.",
    );
    expectRejected(
      () => insertSessionMedia.run(randomUUID(), sessionId, mediaIds[2], "1h", 1, now, now, now, deviceId, deviceId),
      "duplicate active analysis session media ordinal",
    );

    const reportColumns = columnNames(database, "analysis_report_versions");
    for (const forbidden of ["versionNumber", "updatedAt", "deletedAt", "version", "lastModifiedByDeviceId"]) {
      assert(!reportColumns.has(forbidden), "Immutable report contains forbidden column: " + forbidden);
    }

    for (const [tableName, columnName] of [
      ["accounts", "initialBalanceMinor"],
      ["trades", "accountEquityAtEntryMinor"],
      ["trades", "riskAmountMinor"],
      ["trades", "pnlAmountMinor"],
    ]) {
      assert(columnType(database, tableName, columnName) === "INTEGER", tableName + "." + columnName + " is not INTEGER affinity.");
    }

    const requiredIndexes = [
      ["trades", ["accountId"]],
      ["trades", ["instrument"]],
      ["trades", ["status"]],
      ["trades", ["outcome"]],
      ["trades", ["openedAt"]],
      ["trades", ["closedAt"]],
      ["trades", ["deletedAt"]],
      ["journal_entries", ["createdAt"]],
      ["journal_entries", ["tradeId"]],
      ["media_assets", ["tradeId"]],
      ["media_assets", ["journalEntryId"]],
      ["media_assets", ["folderId"]],
      ["media_assets", ["checksumSha256"]],
      ["goals", ["status"]],
      ["goals", ["dueDate"]],
      ["habit_entries", ["habitId", "entryDate"]],
      ["analysis_sessions", ["linkedTradeId"]],
      ["analysis_session_media", ["sessionId", "ordinal"]],
      ["analysis_report_versions", ["sessionId", "analyzedAt"]],
      ["sync_changes", ["changeId"], true],
      ["sync_changes", ["originDeviceId", "originSeq"], true],
      ["sync_changes", ["entityType", "entityId"]],
      ["sync_change_receipts", ["status"]],
      ["sync_pending_changes", ["dependencyEntityType", "dependencyEntityId"]],
      ["sync_conflicts", ["localChangeId", "remoteChangeId"]],
      ["sync_conflicts", ["status"]],
      ["sync_conflicts", ["entityType", "entityId"]],
      ["sync_pairing_invitations", ["userId", "ownerDeviceId", "expiresAt", "completedAt"]],
      ["sync_peers", ["localDeviceId", "updatedAt"]],
      ["sync_peers", ["localDeviceId", "peerDeviceId"], true],
      ["sync_pairing_invitations", ["ownerDeviceId", "joiningDeviceId"], true],
    ];
    for (const [tableName, indexColumns, unique] of requiredIndexes) {
      assert(indexCovers(database, tableName, indexColumns, unique), "Missing required index on " + tableName + "(" + indexColumns.join(", ") + ").");
    }
    for (const columnName of ["authAlgorithm", "authPublicKey", "authKeyFingerprint", "trustedAt"]) {
      assert(columnNames(database, "devices").has(columnName), "Missing devices authentication column: " + columnName);
    }
    assert(indexCovers(database, "devices", ["authKeyFingerprint"], true), "Missing unique device authentication fingerprint index.");
    assert(indexCovers(database, "devices", ["userId", "retiredAt", "trustedAt"]), "Missing device trust lookup index.");

    return {
      tables: tables.length,
      migration: "001 + 002 + 003 + 004",
      idempotent: true,
      foreignKeys: true,
      databasePath,
    };
  } finally {
    closeDatabase(database);
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

try {
  const result = runVerification();
  console.log("SQLite schema verification passed: " + result.tables + " tables, migration " + result.migration + ", idempotency confirmed");
} catch (error) {
  console.error("SQLite schema verification failed: " + error.message);
  process.exitCode = 1;
}
