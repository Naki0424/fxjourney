import express from "express";
import { findDeviceById } from "./repositories/deviceRepository.js";
import { SYNC_PROTOCOL_VERSION } from "./syncAdapters.js";
import {
  SYNC_AUTH_ALGORITHM,
  SYNC_AUTH_PROTOCOL_VERSION,
  isValidRequestId,
  requestBodyHash,
  verifySyncRequest,
} from "./syncAuth.js";
import { SyncValidationError } from "./syncAdapters.js";

export const SYNC_TRANSPORT_SCHEMA_VERSION = "003";
export const SYNC_TRANSPORT_CAPABILITIES = Object.freeze([
  "accounts",
  "trades",
  "tombstones",
  "conflicts",
]);
export const DEFAULT_SYNC_TRANSPORT_LIMITS = Object.freeze({
  maxChanges: 100,
  maxEvents: 100,
  maxBodyBytes: 256 * 1024,
  authSkewMs: 5 * 60 * 1000,
  replayCacheSize: 10_000,
});

export function captureSyncRequestBody(request, response, buffer) {
  if (request.originalUrl?.startsWith("/api/sync") || request.originalUrl?.startsWith("/api/pairing")) {
    request.rawBody = Buffer.from(buffer);
  }
}

export class SyncTransportError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SyncTransportError";
    this.code = code;
    this.status = status;
  }
}

export function createSyncTransportRouter({ database, getContext, syncService, limits = {} } = {}) {
  const configuredLimits = { ...DEFAULT_SYNC_TRANSPORT_LIMITS, ...limits };
  const replayCache = new Map();
  const router = express.Router();

  router.use((request, response, next) => {
    try {
      assertBodyLimit(request, configuredLimits.maxBodyBytes);
      next();
    } catch (error) {
      next(error);
    }
  });
  router.use(authenticateRequest({ database, getContext, replayCache, limits: configuredLimits }));

  router.post("/handshake", (request, response, next) => {
    try {
      const hello = requestObject(request.body, "Handshake body must be a JSON object.");
      assertProtocolAndSchema(hello);
      if (hello.deviceId !== undefined && hello.deviceId !== request.syncPeer.deviceId) {
        throw new SyncTransportError("AUTH_FAILED", "Authenticated device does not match the handshake.", 401);
      }
      if (hello.capabilities !== undefined && (!Array.isArray(hello.capabilities) || hello.capabilities.some((capability) => typeof capability !== "string"))) {
        throw new SyncTransportError("INVALID_EVENT", "Handshake capabilities are invalid.", 400);
      }
      const local = getContext();
      const state = syncService.getSyncState(local.deviceId, request.syncPeer.deviceId);
      response.json({
        ok: true,
        deviceId: local.deviceId,
        workspaceId: local.userId,
        protocolVersion: SYNC_PROTOCOL_VERSION,
        schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
        capabilities: SYNC_TRANSPORT_CAPABILITIES,
        sync: {
          lastReceivedRemoteSeq: state.lastReceivedRemoteSeq,
          lastSentLocalSeq: state.lastSentLocalSeq,
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/changes", (request, response, next) => {
    try {
      const after = parseCursor(request.query.after);
      const limit = parseLimit(request.query.limit, configuredLimits.maxChanges);
      const local = getContext();
      const result = syncService.getChangesAfter(local.deviceId, after, limit);
      response.json({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
        deviceId: local.deviceId,
        workspaceId: local.userId,
        ...result,
      });
    } catch (error) {
      next(error instanceof SyncValidationError ? new SyncTransportError("INVALID_CURSOR", "The sync cursor is invalid.", 400) : error);
    }
  });

  router.post("/apply", (request, response, next) => {
    try {
      const body = requestObject(request.body, "Apply body must be a JSON object.");
      assertProtocolAndSchema(body);
      if (!Array.isArray(body.events)) {
        throw new SyncTransportError("INVALID_EVENT", "Apply events must be an array.", 400);
      }
      if (body.events.length > configuredLimits.maxEvents) {
        throw new SyncTransportError("PAYLOAD_TOO_LARGE", "The apply request contains too many events.", 413);
      }
      if (body.events.some((event) => event?.originDeviceId !== request.syncPeer.deviceId)) {
        throw new SyncTransportError("AUTH_FAILED", "Apply events must originate from the authenticated device.", 401);
      }
      const local = getContext();
      const result = syncService.applyChanges({
        localDeviceId: local.deviceId,
        remoteDeviceId: request.syncPeer.deviceId,
        events: body.events,
      });
      response.json({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        schemaVersion: SYNC_TRANSPORT_SCHEMA_VERSION,
        deviceId: local.deviceId,
        workspaceId: local.userId,
        ...result,
      });
    } catch (error) {
      next(mapSyncServiceError(error));
    }
  });

  router.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const mapped = mapTransportError(error);
    response.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
  });

  return router;
}

function authenticateRequest({ database, getContext, replayCache, limits }) {
  return (request, response, next) => {
    try {
      const deviceId = request.get("x-fxj-device-id");
      const timestamp = request.get("x-fxj-timestamp");
      const requestId = request.get("x-fxj-request-id");
      const signature = request.get("x-fxj-signature");
      const protocolVersion = request.get("x-fxj-protocol-version");
      if (!deviceId || !timestamp || !requestId || !signature || !protocolVersion) {
        throw new SyncTransportError("AUTH_FAILED", "Sync authentication is required.", 401);
      }
      if (protocolVersion !== SYNC_AUTH_PROTOCOL_VERSION) {
        throw new SyncTransportError("PROTOCOL_MISMATCH", "The sync authentication protocol is incompatible.", 409);
      }
      if (!isValidRequestId(requestId)) {
        throw new SyncTransportError("AUTH_FAILED", "The sync request identity is invalid.", 401);
      }
      const timestampNumber = Number(timestamp);
      if (!Number.isSafeInteger(timestampNumber) || Math.abs(Date.now() - timestampNumber) > limits.authSkewMs) {
        throw new SyncTransportError("AUTH_FAILED", "The sync authentication timestamp is outside the acceptance window.", 401);
      }

      const device = findDeviceById(database, deviceId);
      if (!device) throw new SyncTransportError("DEVICE_UNKNOWN", "The sync device is not registered.", 401);
      const local = getContext();
      if (device.userId !== local.userId) throw new SyncTransportError("WORKSPACE_MISMATCH", "The sync device is outside this workspace.", 403);
      if (device.retiredAt) throw new SyncTransportError("DEVICE_RETIRED", "The sync device is retired.", 403);
      if (!device.trustedAt || device.authAlgorithm !== SYNC_AUTH_ALGORITHM || !device.authPublicKey) {
        throw new SyncTransportError("DEVICE_UNKNOWN", "The sync device is not trusted for synchronization.", 401);
      }

      const body = request.rawBody || Buffer.from(request.body === undefined ? "" : JSON.stringify(request.body));
      let validSignature = false;
      try {
        validSignature = verifySyncRequest({
          publicKeySpki: device.authPublicKey,
          signature,
          method: request.method,
          path: request.originalUrl,
          timestamp,
          requestId,
          bodyHash: requestBodyHash(body),
          deviceId,
          protocolVersion,
        });
      } catch {
        validSignature = false;
      }
      if (!validSignature) throw new SyncTransportError("AUTH_FAILED", "Sync request authentication failed.", 401);
      pruneReplayCache(replayCache, Date.now() - limits.authSkewMs * 2, limits.replayCacheSize);
      const replayKey = `${deviceId}:${requestId}`;
      if (replayCache.has(replayKey)) {
        throw new SyncTransportError("REQUEST_REPLAY", "The sync request has already been used.", 409);
      }
      replayCache.set(replayKey, timestampNumber);
      request.syncPeer = { deviceId, device };
      next();
    } catch (error) {
      next(error);
    }
  };
}

function assertBodyLimit(request, maxBodyBytes) {
  const contentLength = Number(request.get("content-length"));
  if (Number.isSafeInteger(contentLength) && contentLength > maxBodyBytes) {
    throw new SyncTransportError("PAYLOAD_TOO_LARGE", "The sync request body is too large.", 413);
  }
  if (request.rawBody && request.rawBody.length > maxBodyBytes) {
    throw new SyncTransportError("PAYLOAD_TOO_LARGE", "The sync request body is too large.", 413);
  }
}

function requestObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncTransportError("INVALID_EVENT", message, 400);
  return value;
}

function assertProtocolAndSchema(body) {
  if (body.protocolVersion !== SYNC_PROTOCOL_VERSION) {
    throw new SyncTransportError("PROTOCOL_MISMATCH", "The sync protocol versions are incompatible.", 409);
  }
  if (body.schemaVersion !== SYNC_TRANSPORT_SCHEMA_VERSION) {
    throw new SyncTransportError("SCHEMA_MISMATCH", "The sync schema versions are incompatible.", 409);
  }
}

function parseCursor(value) {
  const candidate = value === undefined ? 0 : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 0) throw new SyncTransportError("INVALID_CURSOR", "The sync cursor is invalid.", 400);
  return candidate;
}

function parseLimit(value, maximum) {
  const candidate = value === undefined ? maximum : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) {
    throw new SyncTransportError("INVALID_CURSOR", "The sync batch limit is invalid.", 400);
  }
  return candidate;
}

function mapSyncServiceError(error) {
  if (error instanceof SyncValidationError) return new SyncTransportError("INVALID_EVENT", "The sync event was rejected.", 400);
  return error;
}

function mapTransportError(error) {
  if (error instanceof SyncTransportError) return { status: error.status, code: error.code, message: error.message };
  return { status: 500, code: "INTERNAL_ERROR", message: "The sync request could not be completed." };
}

function pruneReplayCache(cache, cutoff, maximumSize) {
  for (const [key, timestamp] of cache) {
    if (timestamp < cutoff) cache.delete(key);
  }
  while (cache.size >= maximumSize) cache.delete(cache.keys().next().value);
}
