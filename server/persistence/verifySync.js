import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, openDatabase } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { writeLocalIdentity } from "./identity.js";
import { insertDevice, findDeviceById } from "./repositories/deviceRepository.js";
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";
import { createAccountService } from "./services/accountService.js";
import { createTradeService } from "./services/tradeService.js";
import { createSyncService } from "./syncService.js";
import { payloadHash } from "./syncRepository.js";
import { createId, nowUtc } from "./utils.js";

function registerDevice(database, deviceId, userId, name) {
  if (findDeviceById(database, deviceId)) return;
  const timestamp = nowUtc();
  insertDevice(database, {
    id: deviceId,
    userId,
    name,
    platform: "SYNC_VERIFY",
    appVersion: "verification",
    createdAt: timestamp,
    lastSeenAt: timestamp,
    retiredAt: null,
  });
}

function openNode(rootDirectory, userId, deviceId, peerDeviceId, label) {
  const nodeDirectory = path.join(rootDirectory, label);
  fs.mkdirSync(nodeDirectory, { recursive: true });
  const databasePath = path.join(nodeDirectory, "node.db");
  const identityPath = path.join(nodeDirectory, "local-identity.json");
  if (!fs.existsSync(identityPath)) writeLocalIdentity({ userId, deviceId }, identityPath);
  const database = openDatabase({ filename: databasePath, wal: false });
  runMigrations(database);
  const context = bootstrapLocalInstallation({ database, identityPath });
  assert.equal(context.userId, userId, `${label} bootstrap changed the workspace user.`);
  assert.equal(context.deviceId, deviceId, `${label} bootstrap changed the device identity.`);
  registerDevice(database, peerDeviceId, userId, `${label} peer`);
  const syncService = createSyncService({ database, getContext: () => context, logger: () => {} });
  return {
    label,
    database,
    databasePath,
    identityPath,
    context,
    syncService,
    accountService: createAccountService({ database, getContext: () => context, syncService }),
    tradeService: createTradeService({ database, getContext: () => context, syncService }),
  };
}

function closeNode(node) {
  if (node?.database?.open) {
    closeDatabase(node.database);
  }
}

function accountInput(name) {
  return {
    name,
    brokerName: "Sync Broker",
    accountType: "DEMO",
    currencyCode: "USD",
    currencyMinorDigits: 2,
    initialBalanceMinor: 1000000,
  };
}

function tradeInput(accountId, instrument = "EURUSD") {
  return {
    accountId,
    instrument,
    direction: "BUY",
    status: "OPEN",
    openedAt: "2026-09-15T08:00:00.000Z",
    entryPrice: "1.1000",
    stopLossPrice: "1.0900",
    quantityLots: "0.10",
    riskPercent: "1.00",
    notes: "Initial sync test",
  };
}

function eventFor(node, originDeviceId, originSeq) {
  const events = node.syncService.getChangesAfter(originDeviceId, originSeq - 1, 1).events;
  assert.equal(events.length, 1, `${node.label} did not export origin sequence ${originSeq}.`);
  assert.equal(events[0].originSeq, originSeq);
  return events[0];
}

function apply(node, remoteDeviceId, events) {
  return node.syncService.applyChanges({ remoteDeviceId, events }).results;
}

function count(database, tableName) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function row(database, sql, ...parameters) {
  return database.prepare(sql).get(...parameters);
}

function assertSameEntity(nodeA, nodeB, tableName, id, message) {
  const left = row(nodeA.database, `SELECT * FROM ${tableName} WHERE id = ?`, id);
  const right = row(nodeB.database, `SELECT * FROM ${tableName} WHERE id = ?`, id);
  assert.deepEqual(right, left, message);
  return left;
}

function runVerification() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-sync-"));
  const userId = createId();
  const deviceA = createId();
  const deviceB = createId();
  let nodeA;
  let nodeB;

  try {
    nodeA = openNode(temporaryDirectory, userId, deviceA, deviceB, "node-a");
    nodeB = openNode(temporaryDirectory, userId, deviceB, deviceA, "node-b");
    assert.notEqual(nodeA.databasePath, nodeB.databasePath, "Nodes do not use independent SQLite files.");

    const account = nodeA.accountService.create(accountInput("Primary A"));
    const firstTrade = nodeA.tradeService.create(tradeInput(account.id));
    const initialEvents = nodeA.syncService.getChangesAfter(deviceA, 0).events;
    assert.deepEqual(initialEvents.map((event) => [event.entityType, event.operation, event.originSeq]), [
      ["ACCOUNT", "CREATE", 1],
      ["TRADE", "CREATE", 2],
    ], "Local Account/Trade event capture did not preserve origin order.");
    assert.equal(initialEvents[0].payloadHash, payloadHash(initialEvents[0].payload));
    assert.equal(initialEvents[0].baseVersion, null);
    assert.equal(initialEvents[0].resultingVersion, 1);
    assert.deepEqual(initialEvents[1].dependencies.map((dependency) => dependency.entityType), ["USER", "ACCOUNT"]);

    const initialApply = apply(nodeB, deviceA, initialEvents);
    assert.deepEqual(initialApply.map((result) => result.status), ["APPLIED", "APPLIED"], "Initial Account/Trade replication failed.");
    assertSameEntity(nodeA, nodeB, "accounts", account.id, "Replicated Account differs from the source snapshot.");
    assertSameEntity(nodeA, nodeB, "trades", firstTrade.id, "Replicated Trade differs from the source snapshot.");
    assert.equal(nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq, 2);
    assert.equal(nodeB.syncService.getChangesAfter(deviceB, 0).events.length, 0, "Remote changes were echoed as local changes.");

    const remoteUpdate = nodeB.tradeService.update(firstTrade.id, { notes: "Edited on B" }, 1);
    assert.equal(remoteUpdate.version, 2);
    const bUpdate = eventFor(nodeB, deviceB, 1);
    assert.equal(apply(nodeA, deviceB, [bUpdate])[0].status, "APPLIED", "Remote Trade update was not applied.");
    assert.equal(row(nodeA.database, "SELECT version FROM trades WHERE id = ?", firstTrade.id).version, 2);
    assert.equal(row(nodeA.database, "SELECT lastModifiedByDeviceId FROM trades WHERE id = ?", firstTrade.id).lastModifiedByDeviceId, deviceB);

    const independentA = nodeA.tradeService.create(tradeInput(account.id, "GBPUSD"));
    const independentB = nodeB.tradeService.create(tradeInput(account.id, "USDJPY"));
    const aIndependent = eventFor(nodeA, deviceA, 3);
    const bIndependent = eventFor(nodeB, deviceB, 2);
    assert.equal(apply(nodeB, deviceA, [aIndependent])[0].status, "APPLIED", "Independent A creation did not replicate.");
    assert.equal(apply(nodeA, deviceB, [bIndependent])[0].status, "APPLIED", "Independent B creation did not replicate.");
    assertSameEntity(nodeA, nodeB, "trades", independentA.id, "Independent A Trade did not converge.");
    assertSameEntity(nodeA, nodeB, "trades", independentB.id, "Independent B Trade did not converge.");

    const conflictsBeforeDuplicate = count(nodeB.database, "sync_conflicts");
    const duplicateResult = apply(nodeB, deviceA, [aIndependent])[0];
    assert.equal(duplicateResult.status, "DUPLICATE", "Duplicate replay was not identified.");
    assert.equal(count(nodeB.database, "sync_conflicts"), conflictsBeforeDuplicate, "Duplicate replay created a conflict.");

    const conflictTrade = nodeA.tradeService.create(tradeInput(account.id, "AUDUSD"));
    const conflictCreate = eventFor(nodeA, deviceA, 4);
    assert.equal(apply(nodeB, deviceA, [conflictCreate])[0].status, "APPLIED");
    nodeA.tradeService.update(conflictTrade.id, { notes: "A version" }, 1);
    nodeB.tradeService.update(conflictTrade.id, { notes: "B version" }, 1);
    const aConflictEdit = eventFor(nodeA, deviceA, 5);
    const bConflictEdit = eventFor(nodeB, deviceB, 3);
    const bConflictResult = apply(nodeB, deviceA, [aConflictEdit])[0];
    const aConflictResult = apply(nodeA, deviceB, [bConflictEdit])[0];
    assert.equal(bConflictResult.status, "CONFLICT", "Concurrent Trade edits did not conflict on B.");
    assert.equal(aConflictResult.status, "CONFLICT", "Concurrent Trade edits did not conflict on A.");
    assert.equal(row(nodeB.database, "SELECT notes FROM trades WHERE id = ?", conflictTrade.id).notes, "B version");
    assert.equal(row(nodeA.database, "SELECT notes FROM trades WHERE id = ?", conflictTrade.id).notes, "A version");

    const editDeleteTrade = nodeA.tradeService.create(tradeInput(account.id, "NZDUSD"));
    const editDeleteCreate = eventFor(nodeA, deviceA, 6);
    assert.equal(apply(nodeB, deviceA, [editDeleteCreate])[0].status, "APPLIED");
    nodeA.tradeService.update(editDeleteTrade.id, { notes: "Edit wins locally" }, 1);
    nodeB.tradeService.remove(editDeleteTrade.id, 1);
    const editEvent = eventFor(nodeA, deviceA, 7);
    const deleteEvent = eventFor(nodeB, deviceB, 4);
    assert.equal(apply(nodeB, deviceA, [editEvent])[0].status, "CONFLICT");
    assert.equal(apply(nodeA, deviceB, [deleteEvent])[0].status, "CONFLICT");
    const editDeleteConflicts = nodeB.database.prepare(
      "SELECT conflictType, localPayloadJson, remotePayloadJson FROM sync_conflicts WHERE entityId = ? ORDER BY detectedAt",
    ).all(editDeleteTrade.id);
    assert(editDeleteConflicts.some((conflict) => conflict.conflictType === "DELETE_EDIT_CONFLICT"), "Edit/delete conflict was not preserved.");
    assert(editDeleteConflicts.every((conflict) => conflict.localPayloadJson && conflict.remotePayloadJson), "Conflict payloads were not preserved.");

    const deletedTrade = nodeA.tradeService.create(tradeInput(account.id, "USDCAD"));
    const deletedCreate = eventFor(nodeA, deviceA, 8);
    assert.equal(apply(nodeB, deviceA, [deletedCreate])[0].status, "APPLIED");
    nodeA.tradeService.remove(deletedTrade.id, 1);
    const deletedEvent = eventFor(nodeA, deviceA, 9);
    assert.equal(apply(nodeB, deviceA, [deletedEvent])[0].status, "APPLIED", "Normal Trade tombstone did not replicate.");
    assert.equal(row(nodeB.database, "SELECT deletedAt, version FROM trades WHERE id = ?", deletedTrade.id).version, 2);
    assert(row(nodeB.database, "SELECT deletedAt FROM trades WHERE id = ?", deletedTrade.id).deletedAt, "Trade tombstone was not retained.");
    assert.equal(nodeB.tradeService.list().some((trade) => trade.id === deletedTrade.id), false, "Deleted Trade remained in the active list.");

    const dependencyAccount = nodeA.accountService.create(accountInput("Dependency Account"));
    const dependencyTrade = nodeA.tradeService.create(tradeInput(dependencyAccount.id, "CADJPY"));
    const dependencyAccountEvent = eventFor(nodeA, deviceA, 10);
    const dependencyTradeEvent = eventFor(nodeA, deviceA, 11);
    assert.equal(apply(nodeB, deviceA, [dependencyTradeEvent])[0].status, "PENDING", "Trade-first delivery was not deferred.");
    assert.equal(row(nodeB.database, "SELECT id FROM trades WHERE id = ?", dependencyTrade.id), undefined);
    assert.equal(nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq, 9, "Cursor advanced past a pending dependency.");
    const dependencyApply = apply(nodeB, deviceA, [dependencyAccountEvent]);
    assert(dependencyApply.some((result) => result.status === "APPLIED"), "Dependency Account was not applied.");
    assert(dependencyApply.some((result) => result.status === "APPLIED" && result.changeId === dependencyTradeEvent.changeId), "Pending Trade was not retried after its Account dependency.");
    assert.equal(nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq, 11);
    assertSameEntity(nodeA, nodeB, "trades", dependencyTrade.id, "Dependency-ordered Trade did not converge.");

    const accountCountBeforeAtomicFailure = count(nodeA.database, "accounts");
    const changeCountBeforeAtomicFailure = count(nodeA.database, "sync_changes");
    const sequenceBeforeAtomicFailure = row(nodeA.database, "SELECT nextOriginSeq FROM sync_device_sequences WHERE deviceId = ?", deviceA).nextOriginSeq;
    const failingSync = createSyncService({
      database: nodeA.database,
      getContext: () => nodeA.context,
      logger: () => {},
      eventWriter() {
        throw new Error("injected event writer failure");
      },
    });
    const failingAccountService = createAccountService({ database: nodeA.database, getContext: () => nodeA.context, syncService: failingSync });
    assert.throws(() => failingAccountService.create(accountInput("Rolled Back")), /injected event writer failure/);
    assert.equal(count(nodeA.database, "accounts"), accountCountBeforeAtomicFailure, "Failed Account mutation was not rolled back.");
    assert.equal(count(nodeA.database, "sync_changes"), changeCountBeforeAtomicFailure, "Failed event capture left an orphan event.");
    assert.equal(row(nodeA.database, "SELECT nextOriginSeq FROM sync_device_sequences WHERE deviceId = ?", deviceA).nextOriginSeq, sequenceBeforeAtomicFailure, "Failed event capture consumed an origin sequence.");
    assert.throws(() => nodeA.tradeService.create({ ...tradeInput(account.id), direction: "INVALID" }), /direction/);
    assert.equal(count(nodeA.database, "sync_changes"), changeCountBeforeAtomicFailure, "Rejected domain input created an event.");

    const syncedAccount = nodeA.accountService.create(accountInput("Account Lifecycle"));
    const syncedAccountCreate = eventFor(nodeA, deviceA, 12);
    assert.equal(apply(nodeB, deviceA, [syncedAccountCreate])[0].status, "APPLIED");
    nodeA.accountService.update(syncedAccount.id, { name: "Account Lifecycle Updated" }, 1);
    const syncedAccountUpdate = eventFor(nodeA, deviceA, 13);
    assert.equal(apply(nodeB, deviceA, [syncedAccountUpdate])[0].status, "APPLIED");
    nodeA.accountService.remove(syncedAccount.id, 2);
    const syncedAccountDelete = eventFor(nodeA, deviceA, 14);
    assert.equal(apply(nodeB, deviceA, [syncedAccountDelete])[0].status, "APPLIED");
    assert.equal(row(nodeB.database, "SELECT active FROM accounts WHERE id = ?", syncedAccount.id).active, 0);
    assert(row(nodeB.database, "SELECT deletedAt FROM accounts WHERE id = ?", syncedAccount.id).deletedAt, "Account tombstone was not retained.");

    const securityAccount = nodeA.accountService.create(accountInput("Validation Account"));
    const securityEvent = eventFor(nodeA, deviceA, 15);
    const otherUserId = createId();
    const wrongWorkspaceEvent = {
      ...securityEvent,
      payload: { ...securityEvent.payload, userId: otherUserId },
      dependencies: [{ entityType: "USER", entityId: otherUserId }],
    };
    wrongWorkspaceEvent.payloadHash = payloadHash(wrongWorkspaceEvent.payload);
    const countsBeforeRejection = { accounts: count(nodeB.database, "accounts"), changes: count(nodeB.database, "sync_changes") };
    assert.equal(apply(nodeB, deviceA, [wrongWorkspaceEvent])[0].status, "REJECTED", "Wrong-workspace event was accepted.");
    assert.equal(count(nodeB.database, "accounts"), countsBeforeRejection.accounts);
    assert.equal(count(nodeB.database, "sync_changes"), countsBeforeRejection.changes);
    const malformedEvents = [
      { ...securityEvent, changeId: createId(), originSeq: 16, operation: "UPSERT" },
      { ...securityEvent, changeId: createId(), originSeq: 17, entityId: "not-a-uuid" },
      { ...securityEvent, changeId: createId(), originSeq: 18, payloadHash: "0".repeat(64) },
      { ...securityEvent, changeId: createId(), originSeq: 19, baseVersion: 1, resultingVersion: 2 },
    ];
    for (const malformedEvent of malformedEvents) {
      assert.equal(apply(nodeB, deviceA, [malformedEvent])[0].status, "REJECTED", "Malformed sync event was accepted.");
    }
    assert.equal(count(nodeB.database, "sync_changes"), countsBeforeRejection.changes);
    assert.equal(nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq, 14, "Rejected events advanced the cursor.");

    for (const [node, originDeviceId, expectedCount] of [[nodeA, deviceA, 15], [nodeB, deviceB, 4]]) {
      const sequences = node.database.prepare(
        "SELECT originSeq FROM sync_changes WHERE originDeviceId = ? ORDER BY originSeq",
      ).pluck().all(originDeviceId);
      assert.deepEqual(sequences, Array.from({ length: expectedCount }, (_, index) => index + 1), `${node.label} origin sequence is not contiguous.`);
    }

    const states = nodeB.database.prepare("SELECT localDeviceId, remoteDeviceId, lastReceivedRemoteSeq, status FROM sync_state ORDER BY localDeviceId, remoteDeviceId").all();
    assert(states.some((state) => state.localDeviceId === deviceB && state.remoteDeviceId === deviceA && state.lastReceivedRemoteSeq === 14 && state.status === "IDLE"));
    assert.equal(row(nodeB.database, "SELECT COUNT(*) AS count FROM sync_changes WHERE originDeviceId = ?", deviceB).count, 4, "Unexpected local event count before restart.");

    const cursorBeforeRestart = nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq;
    const identityBeforeRestart = { userId: nodeB.context.userId, deviceId: nodeB.context.deviceId, fingerprint: nodeB.context.auth.fingerprint };
    closeNode(nodeB);
    nodeB = openNode(temporaryDirectory, userId, deviceB, deviceA, "node-b");
    assert.equal(nodeB.context.userId, identityBeforeRestart.userId, "Restart changed the user identity.");
    assert.equal(nodeB.context.deviceId, identityBeforeRestart.deviceId, "Restart changed the device identity.");
    assert.equal(nodeB.context.auth.fingerprint, identityBeforeRestart.fingerprint, "Restart changed the device credentials.");
    assert.equal(nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq, cursorBeforeRestart, "Remote cursor was not durable across restart.");
    const postRestartTrade = nodeB.tradeService.create(tradeInput(account.id, "CHFJPY"));
    const postRestartEvent = eventFor(nodeB, deviceB, 5);
    assert.equal(postRestartEvent.entityId, postRestartTrade.id);
    assert.equal(apply(nodeA, deviceB, [postRestartEvent])[0].status, "APPLIED", "Post-restart local origin sequence was not usable.");

    return {
      databasePaths: [nodeA.databasePath, nodeB.databasePath],
      initialEvents: 2,
      conflicts: count(nodeA.database, "sync_conflicts") + count(nodeB.database, "sync_conflicts"),
      cursorAfterDependency: 11,
      pendingHandled: true,
      isolated: true,
    };
  } finally {
    closeNode(nodeA);
    closeNode(nodeB);
    cleanupTemporaryDirectory(temporaryDirectory);
  }
}

function cleanupTemporaryDirectory(directory) {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    const cleanupScript = [
      "import fs from 'node:fs';",
      "const target = process.argv[1];",
      "for (let attempt = 0; attempt < 40; attempt += 1) {",
      "  try { fs.rmSync(target, { recursive: true, force: true }); process.exit(0); }",
      "  catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }",
      "}",
      "process.exit(1);",
    ].join(" ");
    const child = spawn(process.execPath, ["--input-type=module", "-e", cleanupScript, directory], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }
}

try {
  const result = runVerification();
  console.log(`Sync verification passed: ${result.initialEvents} initial events, ${result.conflicts} preserved conflict records, dependency cursor ${result.cursorAfterDependency}, isolated nodes ${result.isolated}`);
} catch (error) {
  console.error(`Sync verification failed: ${error.message}`);
  process.exitCode = 1;
}
