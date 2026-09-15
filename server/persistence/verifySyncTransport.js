import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, openDatabase } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { writeLocalIdentity } from "./identity.js";
import { createDeviceAuthentication } from "./syncAuth.js";
import { insertDevice, findDeviceById, updateDeviceAuthentication } from "./repositories/deviceRepository.js";
import { insertUserProfile } from "./repositories/userProfileRepository.js";
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";
import { createAccountService } from "./services/accountService.js";
import { createTradeService } from "./services/tradeService.js";
import { createPersistenceRouter } from "./routes.js";
import { createSyncTransportOrchestrator, createSignedRequestHeaders, createSyncTransportClient } from "./syncTransportClient.js";
import { captureSyncRequestBody, SYNC_TRANSPORT_SCHEMA_VERSION } from "./syncTransport.js";
import { SYNC_PROTOCOL_VERSION } from "./syncAdapters.js";
import { createId, nowUtc } from "./utils.js";

function registerTrustedPeer(database, peer) {
  const existing = findDeviceById(database, peer.context.deviceId);
  if (!existing) {
    const timestamp = nowUtc();
    insertDevice(database, {
      id: peer.context.deviceId,
      userId: peer.context.userId,
      name: `${peer.label} trusted peer`,
      platform: "SYNC_TRANSPORT_VERIFY",
      appVersion: "verification",
      createdAt: timestamp,
      lastSeenAt: timestamp,
      retiredAt: null,
      authAlgorithm: peer.context.auth.algorithm,
      authPublicKey: peer.context.auth.publicKeySpki,
      authKeyFingerprint: peer.context.auth.fingerprint,
      trustedAt: timestamp,
    });
    return;
  }
  updateDeviceAuthentication(database, peer.context.deviceId, {
    ...peer.context.auth,
    trustedAt: existing.trustedAt || nowUtc(),
  });
}

function createNode(rootDirectory, userId, deviceId, label) {
  const nodeDirectory = path.join(rootDirectory, label);
  fs.mkdirSync(nodeDirectory, { recursive: true });
  const databasePath = path.join(nodeDirectory, "node.db");
  const identityPath = path.join(nodeDirectory, "local-identity.json");
  writeLocalIdentity({ userId, deviceId }, identityPath);
  const database = openDatabase({ filename: databasePath, wal: false });
  runMigrations(database);
  const context = bootstrapLocalInstallation({ database, identityPath });
  const node = {
    label,
    database,
    databasePath,
    identityPath,
    context,
    accountService: null,
    tradeService: null,
    syncService: null,
    server: null,
    baseUrl: null,
  };
  registerTrustedPeer(database, node);
  return node;
}

function finishNodeServices(node) {
  const persistenceRouter = createPersistenceRouter({ database: node.database, getContext: () => node.context });
  node.syncService = persistenceRouter.persistenceServices.syncService;
  node.accountService = persistenceRouter.persistenceServices.accountService;
  node.tradeService = persistenceRouter.persistenceServices.tradeService;
  node.persistenceRouter = persistenceRouter;
  return node;
}

function trustPeers(nodeA, nodeB) {
  registerTrustedPeer(nodeA.database, nodeB);
  registerTrustedPeer(nodeB.database, nodeA);
  finishNodeServices(nodeA);
  finishNodeServices(nodeB);
}

function startHttpNode(node) {
  const app = express();
  app.use(express.json({ limit: "1mb", verify: captureSyncRequestBody }));
  app.use("/api", node.persistenceRouter);
  return new Promise((resolve) => {
    node.server = app.listen(0, "127.0.0.1", () => {
      node.baseUrl = `http://127.0.0.1:${node.server.address().port}`;
      resolve(node);
    });
  });
}

function stopHttpNode(node) {
  return new Promise((resolve, reject) => {
    if (!node.server) {
      resolve();
      return;
    }
    node.server.close((error) => {
      node.server = null;
      if (error) reject(error);
      else resolve();
    });
  });
}

function closeNode(node) {
  if (node?.database?.open) closeDatabase(node.database);
}

function accountInput(name) {
  return {
    name,
    brokerName: "Transport Broker",
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
    notes: "HTTP transport verification",
  };
}

function eventFor(node, originDeviceId, originSeq) {
  const result = node.syncService.getChangesAfter(originDeviceId, originSeq - 1, 1).events;
  assert.equal(result.length, 1, `${node.label} did not export origin sequence ${originSeq}.`);
  return result[0];
}

function count(database, tableName) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function row(database, sql, ...parameters) {
  return database.prepare(sql).get(...parameters);
}

async function readResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  return { status: response.status, body };
}

function orchestrator(node, peer) {
  return createSyncTransportOrchestrator({
    database: node.database,
    getContext: () => node.context,
    syncService: node.syncService,
    identity: { ...node.context.auth, deviceId: node.context.deviceId },
    peerUrl: peer.baseUrl,
    peerDeviceId: peer.context.deviceId,
    timeoutMs: 1500,
  });
}

function client(node, peer) {
  return createSyncTransportClient({
    peerUrl: peer.baseUrl,
    identity: { ...node.context.auth, deviceId: node.context.deviceId },
    timeoutMs: 1500,
  });
}

async function requestRaw({ baseUrl, identity, method, requestPath, rawBody, headers = {} }) {
  const authHeaders = createSignedRequestHeaders({
    identity,
    method,
    path: requestPath,
    rawBody,
  });
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      Accept: "application/json",
      ...authHeaders,
      ...headers,
      ...(rawBody.length ? { "content-type": "application/json", "content-length": String(rawBody.length) } : {}),
    },
    body: rawBody.length ? rawBody : undefined,
  });
  return readResponse(response);
}

function jsonBody(value) {
  return Buffer.from(JSON.stringify(value));
}

async function runVerification() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-sync-transport-"));
  const userId = createId();
  const deviceA = createId();
  const deviceB = createId();
  let nodeA;
  let nodeB;
  try {
    nodeA = createNode(temporaryDirectory, userId, deviceA, "node-a");
    nodeB = createNode(temporaryDirectory, userId, deviceB, "node-b");
    trustPeers(nodeA, nodeB);
    await startHttpNode(nodeA);
    await startHttpNode(nodeB);

    const identityA = { ...nodeA.context.auth, deviceId: deviceA };
    const identityB = { ...nodeB.context.auth, deviceId: deviceB };
    const clientA = () => client(nodeA, nodeB);
    const clientB = () => client(nodeB, nodeA);
    const handshakeA = await clientA().handshake();
    const handshakeB = await clientB().handshake();
    assert.equal(handshakeA.deviceId, deviceB);
    assert.equal(handshakeB.deviceId, deviceA);
    assert.equal(handshakeA.workspaceId, userId);
    assert.deepEqual(handshakeA.capabilities, ["accounts", "trades", "tombstones", "conflicts"]);
    assert.equal(handshakeA.protocolVersion, SYNC_PROTOCOL_VERSION);
    assert.equal(handshakeA.schemaVersion, SYNC_TRANSPORT_SCHEMA_VERSION);

    const trustedStateRowsBeforeAuthTests = count(nodeB.database, "sync_state");
    const badAuthBody = jsonBody({
      deviceId: deviceA,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
      capabilities: ["accounts", "trades", "tombstones", "conflicts"],
    });
    const unknownIdentity = { ...createDeviceAuthentication(), deviceId: createId() };
    const helloBody = {
      deviceId: unknownIdentity.deviceId,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
      capabilities: ["accounts", "trades", "tombstones", "conflicts"],
    };
    const unknownResponse = await requestRaw({
      baseUrl: nodeB.baseUrl,
      identity: unknownIdentity,
      method: "POST",
      requestPath: "/api/sync/handshake",
      rawBody: jsonBody(helloBody),
    });
    assert.equal(unknownResponse.status, 401);
    assert.equal(unknownResponse.body.error.code, "DEVICE_UNKNOWN");

    const otherUserId = createId();
    const otherUserTimestamp = nowUtc();
    insertUserProfile(nodeB.database, {
      id: otherUserId,
      displayName: "Other Workspace",
      avatarMediaId: null,
      createdAt: otherUserTimestamp,
      updatedAt: otherUserTimestamp,
      deletedAt: null,
      version: 1,
      originDeviceId: deviceA,
      lastModifiedByDeviceId: deviceA,
    });
    nodeB.database.prepare("UPDATE devices SET userId = ? WHERE id = ?").run(otherUserId, deviceA);
    const workspaceMismatch = await requestRaw({
      baseUrl: nodeB.baseUrl,
      identity: identityA,
      method: "POST",
      requestPath: "/api/sync/handshake",
      rawBody: badAuthBody,
    });
    assert.equal(workspaceMismatch.status, 403);
    assert.equal(workspaceMismatch.body.error.code, "WORKSPACE_MISMATCH");
    nodeB.database.prepare("UPDATE devices SET userId = ? WHERE id = ?").run(userId, deviceA);

    const badHeaders = createSignedRequestHeaders({
      identity: identityA,
      method: "POST",
      path: "/api/sync/handshake",
      rawBody: badAuthBody,
    });
    badHeaders["x-fxj-signature"] = `${badHeaders["x-fxj-signature"].slice(0, -2)}aa`;
    const badAuthResponse = await requestWithHeaders(nodeB.baseUrl, "/api/sync/handshake", "POST", badAuthBody, badHeaders);
    assert.equal(badAuthResponse.status, 401);
    assert.equal(badAuthResponse.body.error.code, "AUTH_FAILED");
    assert.equal(count(nodeB.database, "sync_state"), trustedStateRowsBeforeAuthTests, "Bad authentication changed sync state.");

    nodeB.database.prepare("UPDATE devices SET retiredAt = ? WHERE id = ?").run(nowUtc(), deviceA);
    const retiredResponse = await requestRaw({
      baseUrl: nodeB.baseUrl,
      identity: identityA,
      method: "POST",
      requestPath: "/api/sync/handshake",
      rawBody: badAuthBody,
    });
    assert.equal(retiredResponse.status, 403);
    assert.equal(retiredResponse.body.error.code, "DEVICE_RETIRED");
    nodeB.database.prepare("UPDATE devices SET retiredAt = NULL WHERE id = ?").run(deviceA);

    const protocolMismatchBody = jsonBody({ ...helloBody, deviceId: deviceA, protocolVersion: "999" });
    const protocolMismatch = await requestRaw({
      baseUrl: nodeB.baseUrl,
      identity: identityA,
      method: "POST",
      requestPath: "/api/sync/handshake",
      rawBody: protocolMismatchBody,
    });
    assert.equal(protocolMismatch.status, 409);
    assert.equal(protocolMismatch.body.error.code, "PROTOCOL_MISMATCH");

    const schemaMismatchBody = jsonBody({ ...helloBody, deviceId: deviceA, schemaVersion: "999" });
    const schemaMismatch = await requestRaw({
      baseUrl: nodeB.baseUrl,
      identity: identityA,
      method: "POST",
      requestPath: "/api/sync/handshake",
      rawBody: schemaMismatchBody,
    });
    assert.equal(schemaMismatch.status, 409);
    assert.equal(schemaMismatch.body.error.code, "SCHEMA_MISMATCH");

    const account = nodeA.accountService.create(accountInput("HTTP Primary"));
    const trade = nodeA.tradeService.create(tradeInput(account.id));
    const initial = await orchestrator(nodeA, nodeB).syncWithPeer();
    assert.equal(initial.ok, true, `Initial HTTP sync failed: ${initial.error || "unknown error"}`);
    assert.equal(row(nodeB.database, "SELECT id FROM accounts WHERE id = ?", account.id).id, account.id);
    assert.equal(row(nodeB.database, "SELECT id, version, originDeviceId FROM trades WHERE id = ?", trade.id).originDeviceId, deviceA);
    assert.equal(row(nodeB.database, "SELECT version FROM trades WHERE id = ?", trade.id).version, 1);
    assert.equal(nodeB.syncService.getChangesAfter(deviceB, 0).events.length, 0, "HTTP remote apply created a local echo.");

    nodeB.tradeService.update(trade.id, { notes: "Updated over HTTP from B" }, 1);
    const reverse = await orchestrator(nodeB, nodeA).syncWithPeer();
    assert.equal(reverse.ok, true, `Reverse HTTP sync failed: ${reverse.error || "unknown error"}`);
    assert.equal(row(nodeA.database, "SELECT notes, version, lastModifiedByDeviceId FROM trades WHERE id = ?", trade.id).notes, "Updated over HTTP from B");
    assert.equal(row(nodeA.database, "SELECT version FROM trades WHERE id = ?", trade.id).version, 2);
    assert.equal(row(nodeA.database, "SELECT lastModifiedByDeviceId FROM trades WHERE id = ?", trade.id).lastModifiedByDeviceId, deviceB);

    const duplicateChange = eventFor(nodeA, deviceA, 2);
    const duplicate = await clientA().apply([duplicateChange]);
    assert.equal(duplicate.results[0].status, "DUPLICATE", "HTTP duplicate change was not idempotent.");
    assert.equal(row(nodeB.database, "SELECT version FROM trades WHERE id = ?", trade.id).version, 2);

    const replayBody = jsonBody({
      deviceId: deviceA,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
      capabilities: ["accounts", "trades", "tombstones", "conflicts"],
    });
    const replayHeaders = createSignedRequestHeaders({ identity: identityA, method: "POST", path: "/api/sync/handshake", rawBody: replayBody });
    const replayFirst = await requestWithHeaders(nodeB.baseUrl, "/api/sync/handshake", "POST", replayBody, replayHeaders);
    const replaySecond = await requestWithHeaders(nodeB.baseUrl, "/api/sync/handshake", "POST", replayBody, replayHeaders);
    assert.equal(replayFirst.status, 200);
    assert.equal(replaySecond.status, 409);
    assert.equal(replaySecond.body.error.code, "REQUEST_REPLAY");

    await stopHttpNode(nodeB);
    const offlineTrade = nodeA.tradeService.create(tradeInput(account.id, "GBPUSD"));
    const offline = await orchestrator(nodeA, nodeB).syncWithPeer();
    assert.equal(offline.ok, false);
    assert.equal(offline.offline, true);
    assert.equal(row(nodeA.database, "SELECT id FROM trades WHERE id = ?", offlineTrade.id).id, offlineTrade.id);
    await startHttpNode(nodeB);
    const reconnect = await orchestrator(nodeA, nodeB).syncWithPeer();
    assert.equal(reconnect.ok, true, `Reconnect sync failed: ${reconnect.error || "unknown error"}`);
    assert.equal(row(nodeB.database, "SELECT id FROM trades WHERE id = ?", offlineTrade.id).id, offlineTrade.id);

    await stopHttpNode(nodeB);
    const offlineA3 = nodeA.tradeService.create(tradeInput(account.id, "AUDUSD"));
    const offlineB3 = nodeB.tradeService.create(tradeInput(account.id, "USDJPY"));
    await startHttpNode(nodeB);
    assert.equal((await orchestrator(nodeA, nodeB).syncWithPeer()).ok, true);
    assert.equal((await orchestrator(nodeB, nodeA).syncWithPeer()).ok, true);
    assert.equal(row(nodeA.database, "SELECT id FROM trades WHERE id = ?", offlineB3.id).id, offlineB3.id);
    assert.equal(row(nodeB.database, "SELECT id FROM trades WHERE id = ?", offlineA3.id).id, offlineA3.id);

    const conflictTrade = nodeA.tradeService.create(tradeInput(account.id, "NZDUSD"));
    assert.equal((await orchestrator(nodeA, nodeB).syncWithPeer()).ok, true);
    await stopHttpNode(nodeB);
    nodeA.tradeService.update(conflictTrade.id, { notes: "A offline conflict" }, 1);
    nodeB.tradeService.update(conflictTrade.id, { notes: "B offline conflict" }, 1);
    await startHttpNode(nodeB);
    assert.equal((await orchestrator(nodeA, nodeB).syncWithPeer()).ok, true);
    assert.equal(row(nodeA.database, "SELECT notes FROM trades WHERE id = ?", conflictTrade.id).notes, "A offline conflict");
    assert.equal(row(nodeB.database, "SELECT notes FROM trades WHERE id = ?", conflictTrade.id).notes, "B offline conflict");
    assert.equal(count(nodeA.database, "sync_conflicts") > 0, true);
    assert.equal(count(nodeB.database, "sync_conflicts") > 0, true);

    const editDeleteTrade = nodeA.tradeService.create(tradeInput(account.id, "CADJPY"));
    assert.equal((await orchestrator(nodeA, nodeB).syncWithPeer()).ok, true);
    await stopHttpNode(nodeB);
    nodeA.tradeService.update(editDeleteTrade.id, { notes: "A edit/delete conflict" }, 1);
    nodeB.tradeService.remove(editDeleteTrade.id, 1);
    await startHttpNode(nodeB);
    assert.equal((await orchestrator(nodeA, nodeB).syncWithPeer()).ok, true);
    assert.equal(row(nodeB.database, "SELECT conflictType FROM sync_conflicts WHERE entityId = ? ORDER BY detectedAt DESC LIMIT 1", editDeleteTrade.id).conflictType, "DELETE_EDIT_CONFLICT");
    assert.equal(row(nodeA.database, "SELECT conflictType FROM sync_conflicts WHERE entityId = ? ORDER BY detectedAt DESC LIMIT 1", editDeleteTrade.id).conflictType, "DELETE_EDIT_CONFLICT");

    const deleteTrade = nodeA.tradeService.create(tradeInput(account.id, "USDCAD"));
    assert.equal((await orchestrator(nodeA, nodeB).syncWithPeer()).ok, true);
    nodeA.tradeService.remove(deleteTrade.id, 1);
    assert.equal((await orchestrator(nodeA, nodeB).syncWithPeer()).ok, true);
    assert.equal(row(nodeB.database, "SELECT deletedAt FROM trades WHERE id = ?", deleteTrade.id).deletedAt !== null, true);
    assert.equal(nodeB.tradeService.list().some((item) => item.id === deleteTrade.id), false);

    const dependencyAccount = nodeA.accountService.create(accountInput("HTTP Dependency"));
    const dependencyTrade = nodeA.tradeService.create(tradeInput(dependencyAccount.id, "CHFJPY"));
    const localEvents = nodeA.syncService.getChangesAfter(deviceA, 0, 100).events;
    const dependencyTradeEvent = localEvents.find((event) => event.entityId === dependencyTrade.id);
    const dependencyAccountEvent = localEvents.find((event) => event.entityId === dependencyAccount.id);
    const pending = await clientA().apply([dependencyTradeEvent]);
    assert.equal(pending.results[0].status, "PENDING");
    assert.equal(row(nodeB.database, "SELECT id FROM trades WHERE id = ?", dependencyTrade.id), undefined);
    const dependencyApplied = await clientA().apply([dependencyAccountEvent]);
    assert(dependencyApplied.results.some((result) => result.changeId === dependencyTradeEvent.changeId && result.status === "APPLIED"));
    assert.equal(row(nodeB.database, "SELECT id FROM trades WHERE id = ?", dependencyTrade.id).id, dependencyTrade.id);

    const oversizedBody = Buffer.from(`{"padding":"${"x".repeat(300_000)}"}`);
    const oversizedHeaders = createSignedRequestHeaders({ identity: identityA, method: "POST", path: "/api/sync/apply", rawBody: oversizedBody });
    const oversized = await requestWithHeaders(nodeB.baseUrl, "/api/sync/apply", "POST", oversizedBody, oversizedHeaders);
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.error.code, "PAYLOAD_TOO_LARGE");
    const tooManyEvents = Array.from({ length: 101 }, () => dependencyAccountEvent);
    let tooManyError;
    try {
      await clientA().apply(tooManyEvents);
    } catch (error) {
      tooManyError = error;
    }
    assert.equal(tooManyError?.code, "PAYLOAD_TOO_LARGE", "Event count limit did not reject the oversized batch.");
    assert.equal(tooManyEvents.length, 101);

    const cursorBeforeRestart = nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq;
    const receiptCountBeforeRestart = count(nodeB.database, "sync_change_receipts");
    await stopHttpNode(nodeB);
    closeNode(nodeB);
    nodeB.database = null;
    const reopenedDatabase = openDatabase({ filename: nodeB.databasePath, wal: false });
    runMigrations(reopenedDatabase);
    nodeB.database = reopenedDatabase;
    nodeB.context = bootstrapLocalInstallation({ database: reopenedDatabase, identityPath: nodeB.identityPath });
    registerTrustedPeer(nodeB.database, nodeA);
    finishNodeServices(nodeB);
    await startHttpNode(nodeB);
    assert.equal(nodeB.context.deviceId, deviceB);
    assert.equal(nodeB.context.auth.fingerprint, identityB.fingerprint);
    assert.equal(nodeB.syncService.getSyncState(deviceB, deviceA).lastReceivedRemoteSeq, cursorBeforeRestart);
    assert.equal(count(nodeB.database, "sync_change_receipts"), receiptCountBeforeRestart);
    const postRestartTrade = nodeB.tradeService.create(tradeInput(account.id, "SEKJPY"));
    const postRestart = await orchestrator(nodeB, nodeA).syncWithPeer();
    assert.equal(postRestart.ok, true, `Post-restart HTTP sync failed: ${postRestart.error || "unknown error"}`);
    assert.equal(row(nodeA.database, "SELECT id FROM trades WHERE id = ?", postRestartTrade.id).id, postRestartTrade.id);
    const loopback = nodeA.server.address().address === "127.0.0.1" && nodeB.server.address().address === "127.0.0.1";
    assert.equal(loopback, true, "Transport verifier did not bind both nodes to loopback.");
    assert(nodeB.syncService.getChangesAfter(deviceB, 0).events.every((event) => event.originDeviceId === deviceB), "B exported a re-originated A event.");

    return {
      loopback,
      accountId: account.id,
      tradeId: trade.id,
      conflicts: count(nodeA.database, "sync_conflicts") + count(nodeB.database, "sync_conflicts"),
      cursorAfterRestart: cursorBeforeRestart,
      duplicate: true,
      offline: true,
    };
  } finally {
    await stopHttpNode(nodeA).catch(() => {});
    await stopHttpNode(nodeB).catch(() => {});
    closeNode(nodeA);
    closeNode(nodeB);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

async function requestWithHeaders(baseUrl, requestPath, method, rawBody, headers) {
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers: {
      Accept: "application/json",
      ...headers,
      ...(rawBody.length ? { "content-type": "application/json", "content-length": String(rawBody.length) } : {}),
    },
    body: rawBody.length ? rawBody : undefined,
  });
  return readResponse(response);
}

try {
  const result = await runVerification();
  console.log(`Sync transport verification passed: authenticated loopback nodes, ${result.conflicts} preserved conflicts, cursor ${result.cursorAfterRestart}, duplicate ${result.duplicate}, offline recovery ${result.offline}`);
} catch (error) {
  console.error(`Sync transport verification failed: ${error.message}`);
  process.exitCode = 1;
}
