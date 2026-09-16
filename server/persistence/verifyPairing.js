import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDatabase, openDatabase } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { readLocalIdentity } from "./identity.js";
import { createPairingInvitation, completePairing, getFreshNodeSummary, adoptJoinedWorkspace } from "./pairingService.js";
import { acceptPairing } from "./pairingClient.js";
import { createPairingRouter } from "./pairingRouter.js";
import { createPersistenceRouter } from "./routes.js";
import { createSyncTransportOrchestrator } from "./syncTransportClient.js";
import { createSignedRequestHeaders } from "./syncTransportClient.js";
import { captureSyncRequestBody } from "./syncTransport.js";
import { createId } from "./utils.js";
import { assertAdvertisedPeerUrl, assertSyncPeerUrl, resolveServerBindHost } from "./syncEndpoints.js";
import { findSyncPeer } from "./syncPeerRepository.js";
import { findDeviceById } from "./repositories/deviceRepository.js";
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";

function createNode(rootDirectory, label) {
  const nodeDirectory = path.join(rootDirectory, label);
  fs.mkdirSync(nodeDirectory, { recursive: true });
  const databasePath = path.join(nodeDirectory, "node.db");
  const identityPath = path.join(nodeDirectory, "local-identity.json");
  const database = openDatabase({ filename: databasePath, wal: false });
  runMigrations(database);
  const node = {
    label,
    database,
    identityPath,
    context: bootstrapLocalInstallation({ database, identityPath }),
    server: null,
    baseUrl: null,
  };
  node.persistenceRouter = createPersistenceRouter({
    database,
    getContext: () => node.context,
    syncAllowedHosts: new Set(),
  });
  node.accountService = node.persistenceRouter.persistenceServices.accountService;
  node.tradeService = node.persistenceRouter.persistenceServices.tradeService;
  node.syncService = node.persistenceRouter.persistenceServices.syncService;
  return node;
}

async function startNode(node) {
  const app = express();
  app.use(express.json({ limit: "1mb", verify: captureSyncRequestBody }));
  app.use("/api", node.persistenceRouter);
  node.server = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  node.baseUrl = `http://127.0.0.1:${node.server.address().port}`;
}

async function stopNode(node) {
  if (!node?.server) return;
  await new Promise((resolve, reject) => node.server.close((error) => error ? reject(error) : resolve()));
  node.server = null;
}

function closeNode(node) {
  if (node?.database?.open) closeDatabase(node.database);
}

function identity(node) {
  return { ...node.context.auth, deviceId: node.context.deviceId };
}

function acceptBody(node, token, endpoint, freshSummary = getFreshNodeSummary(node.database, node.context)) {
  return {
    deviceId: node.context.deviceId,
    token,
    joiningDevice: {
      id: node.context.deviceId,
      name: `${node.label} joining device`,
      platform: "PAIRING_VERIFY",
      appVersion: "verification",
      authentication: {
        algorithm: node.context.auth.algorithm,
        publicKeySpki: node.context.auth.publicKeySpki,
        fingerprint: node.context.auth.fingerprint,
      },
    },
    joiningEndpointUrl: endpoint,
    freshSummary,
  };
}

async function signedJson(baseUrl, method, requestPath, body, requestIdentity, mutateHeaders) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const headers = {
    Accept: "application/json",
    "content-type": "application/json",
    "content-length": String(rawBody.length),
    ...createSignedRequestHeaders({ identity: requestIdentity, method, path: requestPath, rawBody }),
  };
  if (mutateHeaders) mutateHeaders(headers);
  const response = await fetch(`${baseUrl}${requestPath}`, {
    method,
    headers,
    body: rawBody,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function pairingOrchestrator(node, peer) {
  const storedPeer = findSyncPeer(node.database, node.context.deviceId, peer.context.deviceId);
  assert(storedPeer, `${node.label} has no persisted peer record.`);
  return createSyncTransportOrchestrator({
    database: node.database,
    getContext: () => node.context,
    syncService: node.syncService,
    identity: identity(node),
    peerUrl: storedPeer.endpointUrl,
    peerDeviceId: storedPeer.peerDeviceId,
    allowedHosts: new Set(),
    timeoutMs: 1500,
  });
}

function accountInput(name) {
  return {
    name,
    brokerName: "Pairing Verification Broker",
    accountType: "DEMO",
    currencyCode: "USD",
    currencyMinorDigits: 2,
    initialBalanceMinor: 1000000,
  };
}

function tradeInput(accountId, instrument) {
  return {
    accountId,
    instrument,
    direction: "BUY",
    status: "OPEN",
    openedAt: "2026-09-16T08:00:00.000Z",
    entryPrice: "1.1000",
    stopLossPrice: "1.0900",
    quantityLots: "0.10",
    riskPercent: "1.00",
  };
}

async function runVerification() {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-pairing-"));
  let owner;
  let joining;
  let invalid;
  let nonFresh;
  let rollback;
  try {
    assert.equal(resolveServerBindHost("127.0.0.1"), "127.0.0.1");
    assert.equal(resolveServerBindHost("100.64.0.2"), "100.64.0.2");
    assert.throws(() => resolveServerBindHost("0.0.0.0"), /wildcard/);
    assert.throws(() => resolveServerBindHost("192.168.1.20"), /specific Tailscale/);
    assert.throws(() => assertSyncPeerUrl("http://100.64.0.2:3001/", { allowedHosts: new Set() }), /allowlist/);
    assert.equal(assertSyncPeerUrl("http://100.64.0.2:3001/", { allowedHosts: new Set(["100.64.0.2"]) }).hostname, "100.64.0.2");
    assert.throws(() => assertSyncPeerUrl("http://192.168.1.20:3001/", { allowedHosts: new Set(["192.168.1.20"]) }), /Tailscale/);
    assert.throws(() => assertAdvertisedPeerUrl("http://192.168.1.20:3001/"), /Tailscale/);
    assert.equal(assertAdvertisedPeerUrl("http://100.64.0.2:3001/").hostname, "100.64.0.2");

    owner = createNode(rootDirectory, "pc");
    joining = createNode(rootDirectory, "a75");
    invalid = createNode(rootDirectory, "invalid");
    nonFresh = createNode(rootDirectory, "non-fresh");
    rollback = createNode(rootDirectory, "rollback");
    await startNode(owner);
    await startNode(joining);

    const ownerFingerprint = owner.context.auth.fingerprint;
    const invitation = createPairingInvitation({ database: owner.database, getContext: () => owner.context });
    const pairingResult = await acceptPairing({
      database: joining.database,
      context: joining.context,
      identityPath: joining.identityPath,
      token: invitation.token,
      peerUrl: owner.baseUrl,
      ownerFingerprint,
      localEndpoint: joining.baseUrl,
      allowedHosts: new Set(),
      timeoutMs: 1500,
    });
    assert.equal(pairingResult.ok, true);
    const originalJoiningDeviceId = joining.context.deviceId;
    const originalJoiningFingerprint = joining.context.auth.fingerprint;
    joining.context = bootstrapLocalInstallation({ database: joining.database, identityPath: joining.identityPath });
    assert.equal(joining.context.userId, owner.context.userId);
    assert.equal(joining.context.deviceId, originalJoiningDeviceId);
    assert.equal(joining.context.auth.fingerprint, originalJoiningFingerprint);
    assert.notEqual(joining.context.auth.fingerprint, owner.context.auth.fingerprint);
    assert.equal(findDeviceById(owner.database, joining.context.deviceId).trustedAt !== null, true);
    assert.equal(findDeviceById(joining.database, owner.context.deviceId).trustedAt !== null, true);
    assert(findSyncPeer(owner.database, owner.context.deviceId, joining.context.deviceId));
    assert(findSyncPeer(joining.database, joining.context.deviceId, owner.context.deviceId));
    assert.equal(JSON.stringify(pairingResult).includes("privateKeyPkcs8"), false);
    assert.equal(JSON.stringify(owner.database.prepare("SELECT * FROM devices WHERE id = ?").get(joining.context.deviceId)).includes("privateKeyPkcs8"), false);

    const replayed = await signedJson(
      owner.baseUrl,
      "POST",
      "/api/pairing/accept",
      acceptBody(joining, invitation.token, joining.baseUrl, { isFresh: true, total: 0, otherDevices: 0 }),
      identity(joining),
    );
    assert.equal(replayed.status, 409);
    assert.equal(replayed.body.error.code, "PAIRING_ALREADY_COMPLETED");

    const pairedAccount = owner.accountService.create(accountInput("Paired Account"));
    const pairedTrade = owner.tradeService.create(tradeInput(pairedAccount.id, "EURUSD"));
    const pushed = await pairingOrchestrator(owner, joining).syncWithPeer();
    assert.equal(pushed.ok, true, pushed.error || "PC to A75 sync failed.");
    assert.equal(joining.accountService.get(pairedAccount.id).id, pairedAccount.id);
    assert.equal(joining.tradeService.get(pairedTrade.id).id, pairedTrade.id);
    assert.equal(joining.syncService.getChangesAfter(joining.context.deviceId, 0).events.length, 0);
    joining.tradeService.update(pairedTrade.id, { notes: "A75 update" }, 1);
    const pulled = await pairingOrchestrator(joining, owner).syncWithPeer();
    assert.equal(pulled.ok, true, pulled.error || "A75 to PC sync failed.");
    assert.equal(owner.tradeService.get(pairedTrade.id).notes, "A75 update");

    const invalidEndpoint = await Promise.resolve().then(() => acceptPairing({
      database: invalid.database,
      context: invalid.context,
      identityPath: invalid.identityPath,
      token: invitation.token,
      peerUrl: "http://192.168.1.20:3001",
      ownerFingerprint,
      localEndpoint: "http://127.0.0.1:34567",
      allowedHosts: new Set(),
    })).then(() => null, (error) => error);
    assert.equal(invalidEndpoint.code, "PEER_ENDPOINT_NOT_ALLOWED");

    const invalidInvitation = createPairingInvitation({ database: owner.database, getContext: () => owner.context });
    const invalidBody = acceptBody(invalid, invalidInvitation.token, "http://127.0.0.1:34567");
    const invalidSignature = await signedJson(owner.baseUrl, "POST", "/api/pairing/accept", invalidBody, identity(invalid), (headers) => {
      headers["x-fxj-signature"] = `${headers["x-fxj-signature"].slice(0, -2)}aa`;
    });
    assert.equal(invalidSignature.status, 401);
    assert.equal(invalidSignature.body.error.code, "PAIRING_AUTH_INVALID");

    const expiredInvitation = createPairingInvitation({ database: owner.database, getContext: () => owner.context });
    owner.database.prepare("UPDATE sync_pairing_invitations SET expiresAt = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", expiredInvitation.invitationId);
    const expired = await signedJson(owner.baseUrl, "POST", "/api/pairing/accept", acceptBody(invalid, expiredInvitation.token, "http://127.0.0.1:34567"), identity(invalid));
    assert.equal(expired.status, 410);
    assert.equal(expired.body.error.code, "PAIRING_EXPIRED");

    const freshRequirementInvitation = createPairingInvitation({ database: owner.database, getContext: () => owner.context });
    const nonFreshAccount = nonFresh.accountService.create(accountInput("Not Fresh"));
    const nonFreshSummary = getFreshNodeSummary(nonFresh.database, nonFresh.context);
    assert.equal(nonFreshSummary.isFresh, false);
    const notFresh = await signedJson(owner.baseUrl, "POST", "/api/pairing/accept", acceptBody(nonFresh, freshRequirementInvitation.token, "http://127.0.0.1:34568", nonFreshSummary), identity(nonFresh));
    assert.equal(notFresh.status, 409);
    assert.equal(notFresh.body.error.code, "PAIRING_NODE_NOT_FRESH");
    assert.equal(nonFresh.accountService.get(nonFreshAccount.id).id, nonFreshAccount.id);

    const idempotentInvitation = createPairingInvitation({ database: owner.database, getContext: () => owner.context });
    const idempotentBody = acceptBody(invalid, idempotentInvitation.token, "http://127.0.0.1:34569");
    const preparedOne = await signedJson(owner.baseUrl, "POST", "/api/pairing/accept", idempotentBody, identity(invalid));
    const preparedTwo = await signedJson(owner.baseUrl, "POST", "/api/pairing/accept", idempotentBody, identity(invalid));
    assert.equal(preparedOne.status, 200);
    assert.equal(preparedTwo.status, 200);
    assert.notEqual(preparedOne.body.sessionNonce, preparedTwo.body.sessionNonce);
    const substituted = await signedJson(owner.baseUrl, "POST", "/api/pairing/accept", { ...idempotentBody, joiningEndpointUrl: "http://127.0.0.1:34570" }, identity(invalid));
    assert.equal(substituted.status, 409);
    assert.equal(substituted.body.error.code, "PAIRING_ENDPOINT_MISMATCH");
    completePairing({ database: owner.database, getContext: () => owner.context, invitationId: idempotentInvitation.invitationId, joiningDeviceId: invalid.context.deviceId, sessionNonce: preparedTwo.body.sessionNonce });
    assert.equal(findDeviceById(owner.database, invalid.context.deviceId).trustedAt !== null, true);

    const rollbackBeforeIdentity = readLocalIdentity(rollback.identityPath);
    const rollbackWorkspaceId = createId();
    const rollbackPayload = {
      joiningDeviceId: rollback.context.deviceId,
      workspace: { id: rollbackWorkspaceId, displayName: "Rollback Workspace", version: 1 },
      ownerDevice: {
        id: rollback.context.deviceId,
        userId: owner.context.userId,
        name: "PC owner",
        platform: "PAIRING_VERIFY",
        appVersion: "verification",
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        retiredAt: null,
        authAlgorithm: owner.context.auth.algorithm,
        authPublicKey: owner.context.auth.publicKeySpki,
        authKeyFingerprint: owner.context.auth.fingerprint,
      },
    };
    assert.throws(() => adoptJoinedWorkspace({
      database: rollback.database,
      identityPath: rollback.identityPath,
      context: rollback.context,
      payload: rollbackPayload,
      peerUrl: owner.baseUrl,
      localEndpoint: "http://127.0.0.1:34571",
      allowedHosts: new Set(),
      ownerFingerprint,
    }), /conflicts/);
    assert.equal(findDeviceById(rollback.database, rollback.context.deviceId).userId, rollback.context.userId);
    assert.equal(rollback.database.prepare("SELECT id FROM user_profiles WHERE id = ?").get(rollbackWorkspaceId), undefined);
    assert.deepEqual(readLocalIdentity(rollback.identityPath), rollbackBeforeIdentity);

    return {
      workspaceAdopted: true,
      distinctIdentities: true,
      trustPersisted: true,
      endpointPersisted: true,
      accountTradeSync: true,
      replayRejected: true,
      freshNodeEnforced: true,
      rollbackPreserved: true,
      privateKeysTransferred: false,
    };
  } finally {
    await stopNode(owner).catch(() => {});
    await stopNode(joining).catch(() => {});
    await stopNode(invalid).catch(() => {});
    await stopNode(nonFresh).catch(() => {});
    await stopNode(rollback).catch(() => {});
    closeNode(owner);
    closeNode(joining);
    closeNode(invalid);
    closeNode(nonFresh);
    closeNode(rollback);
    fs.rmSync(rootDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
}

try {
  const result = await runVerification();
  console.log(`Pairing verification passed: ${JSON.stringify(result)}`);
} catch (error) {
  console.error(`Pairing verification failed: ${error.message}`);
  process.exitCode = 1;
}
