import { randomUUID } from "node:crypto";
import { requestBodyHash, signSyncRequest } from "./syncAuth.js";
import { SYNC_PROTOCOL_VERSION } from "./syncAdapters.js";
import {
  DEFAULT_SYNC_TRANSPORT_LIMITS,
  SYNC_TRANSPORT_CAPABILITIES,
  SYNC_TRANSPORT_SCHEMA_VERSION,
} from "./syncTransport.js";
import { LOOPBACK_HOSTS, assertSyncPeerUrl, normalizeHost } from "./syncEndpoints.js";

export class SyncTransportClientError extends Error {
  constructor(code, message, { status = null, offline = false } = {}) {
    super(message);
    this.name = "SyncTransportClientError";
    this.code = code;
    this.status = status;
    this.offline = offline;
  }
}

export function assertLoopbackPeerUrl(peerUrl) {
  let parsed;
  try {
    parsed = new URL(peerUrl);
  } catch {
    throw new SyncTransportClientError("INVALID_PEER_URL", "The configured sync peer URL is invalid.");
  }
  if (parsed.protocol !== "http:" || !LOOPBACK_HOSTS.has(normalizeHost(parsed.hostname)) || parsed.username || parsed.password) {
    throw new SyncTransportClientError("INVALID_PEER_URL", "Sync transport is restricted to an explicit loopback HTTP peer.");
  }
  return parsed;
}

export function createSignedRequestHeaders({ identity, method, path, rawBody = Buffer.alloc(0), requestId = randomUUID(), timestamp = Date.now().toString(), protocolVersion = SYNC_PROTOCOL_VERSION }) {
  if (!identity?.privateKeyPkcs8 || !identity.deviceId) {
    throw new SyncTransportClientError("AUTH_FAILED", "Local device authentication is not available.");
  }
  const bodyHash = requestBodyHash(rawBody);
  const signature = signSyncRequest({
    privateKeyPkcs8: identity.privateKeyPkcs8,
    method,
    path,
    timestamp,
    requestId,
    bodyHash,
    deviceId: identity.deviceId,
    protocolVersion,
  });
  return {
    "x-fxj-device-id": identity.deviceId,
    "x-fxj-timestamp": timestamp,
    "x-fxj-request-id": requestId,
    "x-fxj-signature": signature,
    "x-fxj-protocol-version": protocolVersion,
  };
}

export function createSyncTransportClient({ peerUrl, identity, allowedHosts, timeoutMs = 10_000, fetchImpl = globalThis.fetch } = {}) {
  let peer;
  try {
    peer = assertSyncPeerUrl(peerUrl, { allowedHosts });
  } catch (error) {
    throw new SyncTransportClientError(error.code || "INVALID_PEER_URL", error.message);
  }
  if (typeof fetchImpl !== "function") throw new SyncTransportClientError("HTTP_UNAVAILABLE", "The HTTP client is unavailable.");

  async function request(method, requestPath, body) {
    const rawBody = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
    const headers = {
      Accept: "application/json",
      ...createSignedRequestHeaders({ identity, method, path: requestPath, rawBody }),
      ...(body === undefined ? {} : { "content-type": "application/json", "content-length": String(rawBody.length) }),
    };
    const target = new URL(requestPath, peer);
    if (target.origin !== peer.origin || target.protocol !== "http:") {
      throw new SyncTransportClientError("INVALID_PEER_URL", "Sync transport is restricted to the configured private peer.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target, { method, headers, body: rawBody.length ? rawBody : undefined, signal: controller.signal });
      const text = await response.text();
      clearTimeout(timeout);
      let responseBody = null;
      try {
        responseBody = text ? JSON.parse(text) : null;
      } catch {
        throw new SyncTransportClientError("INVALID_RESPONSE", "The sync peer returned an invalid response.", { status: response.status });
      }
      if (!response.ok) {
        const remoteError = responseBody?.error;
        throw new SyncTransportClientError(
          remoteError?.code || "SYNC_FAILED",
          remoteError?.message || "The sync peer rejected the request.",
          { status: response.status, offline: response.status >= 500 },
        );
      }
      return responseBody;
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof SyncTransportClientError) throw error;
      throw new SyncTransportClientError(
        controller.signal.aborted ? "PEER_TIMEOUT" : "PEER_UNAVAILABLE",
        controller.signal.aborted ? "The sync peer request timed out." : "The sync peer is unavailable.",
        { offline: true },
      );
    }
  }

  return {
    request,
    handshake() {
      return request("POST", "/api/sync/handshake", {
        deviceId: identity.deviceId,
        protocolVersion: SYNC_PROTOCOL_VERSION,
        schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
        capabilities: SYNC_TRANSPORT_CAPABILITIES,
      });
    },
    getChanges(after, limit = DEFAULT_SYNC_TRANSPORT_LIMITS.maxChanges) {
      return request("GET", `/api/sync/changes?after=${encodeURIComponent(after)}&limit=${encodeURIComponent(limit)}`);
    },
    apply(events) {
      return request("POST", "/api/sync/apply", {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
        events,
      });
    },
  };
}

export function createSyncTransportOrchestrator({ database, getContext, syncService, identity, peerUrl, peerDeviceId, allowedHosts, timeoutMs, fetchImpl, limits = {} } = {}) {
  const configuredLimits = { ...DEFAULT_SYNC_TRANSPORT_LIMITS, ...limits };
  const localIdentity = { ...identity, deviceId: identity?.deviceId || getContext().deviceId };
  const client = createSyncTransportClient({ peerUrl, identity: localIdentity, allowedHosts, timeoutMs, fetchImpl });

  async function pushLocalChanges() {
    const local = getContext();
    let batches = 0;
    let eventsSent = 0;
    let lastStatuses = [];
    while (batches < 100) {
      const state = syncService.getSyncState(local.deviceId, peerDeviceId);
      const exported = syncService.getChangesAfter(local.deviceId, state.lastSentLocalSeq, configuredLimits.maxChanges);
      if (!exported.events.length) break;
      const applied = await client.apply(exported.events);
      const remoteCursor = Number(applied.cursor);
      if (!Number.isSafeInteger(remoteCursor) || remoteCursor < 0) {
        throw new SyncTransportClientError("INVALID_RESPONSE", "The sync peer returned an invalid cursor.");
      }
      syncService.markChangesSent({ localDeviceId: local.deviceId, remoteDeviceId: peerDeviceId, throughOriginSeq: remoteCursor });
      eventsSent += exported.events.length;
      lastStatuses = applied.results || [];
      batches += 1;
      if (!exported.hasMore || remoteCursor <= state.lastSentLocalSeq) break;
    }
    return { batches, eventsSent, lastStatuses };
  }

  async function pullRemoteChanges() {
    const local = getContext();
    let batches = 0;
    let eventsReceived = 0;
    let lastStatuses = [];
    while (batches < 100) {
      const state = syncService.getSyncState(local.deviceId, peerDeviceId);
      const remote = await client.getChanges(state.lastReceivedRemoteSeq, configuredLimits.maxChanges);
      if (remote.deviceId !== peerDeviceId || remote.workspaceId !== local.userId) {
        throw new SyncTransportClientError("WORKSPACE_MISMATCH", "The sync peer identity does not match the trusted peer.");
      }
      if (!Array.isArray(remote.events) || remote.events.length > configuredLimits.maxChanges) {
        throw new SyncTransportClientError("PAYLOAD_TOO_LARGE", "The sync peer returned too many events.");
      }
      if (!remote.events.length) break;
      const applied = syncService.applyChanges({
        localDeviceId: local.deviceId,
        remoteDeviceId: peerDeviceId,
        events: remote.events,
      });
      eventsReceived += remote.events.length;
      lastStatuses = applied.results;
      batches += 1;
      if (!remote.hasMore || applied.cursor <= state.lastReceivedRemoteSeq) break;
    }
    return { batches, eventsReceived, lastStatuses };
  }

  async function syncWithPeer() {
    try {
      const handshake = await client.handshake();
      const local = getContext();
      if (!handshake.ok || handshake.deviceId !== peerDeviceId || handshake.workspaceId !== local.userId) {
        throw new SyncTransportClientError("WORKSPACE_MISMATCH", "The sync handshake did not match the trusted peer.");
      }
      if (handshake.protocolVersion !== SYNC_PROTOCOL_VERSION) {
        throw new SyncTransportClientError("PROTOCOL_MISMATCH", "The sync protocol versions are incompatible.");
      }
      if (handshake.schemaVersion !== SYNC_TRANSPORT_SCHEMA_VERSION) {
        throw new SyncTransportClientError("SCHEMA_MISMATCH", "The sync schema versions are incompatible.");
      }
      const pushed = await pushLocalChanges();
      const pulled = await pullRemoteChanges();
      return { ok: true, peerDeviceId, pushed, pulled };
    } catch (error) {
      if (error instanceof SyncTransportClientError) return { ok: false, code: error.code, error: error.message, offline: error.offline };
      return { ok: false, code: "INTERNAL_ERROR", error: "The sync cycle could not be completed.", offline: false };
    }
  }

  return { syncWithPeer };
}
