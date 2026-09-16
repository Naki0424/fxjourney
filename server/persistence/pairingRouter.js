import express from "express";
import {
  SYNC_AUTH_ALGORITHM,
  SYNC_AUTH_PROTOCOL_VERSION,
  isValidRequestId,
  normalizePublicDeviceAuthentication,
  requestBodyHash,
  verifySyncRequest,
} from "./syncAuth.js";
import { signPairingResponse } from "./pairingAuth.js";
import { getPendingPairing, preparePairing, completePairing, PairingError } from "./pairingService.js";
import { isUuid } from "./utils.js";

export const DEFAULT_PAIRING_LIMITS = Object.freeze({
  maxBodyBytes: 64 * 1024,
  authSkewMs: 5 * 60 * 1000,
  replayCacheSize: 10_000,
});

export function createPairingRouter({ database, getContext, allowedHosts, limits = {} } = {}) {
  const configuredLimits = { ...DEFAULT_PAIRING_LIMITS, ...limits };
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

  router.post("/accept", authenticateAccept({ getContext, replayCache, limits: configuredLimits }), (request, response, next) => {
    try {
      const body = requestObject(request.body, "The pairing request must be a JSON object.");
      const result = preparePairing({
        database,
        getContext,
        token: body.token,
        joiningDevice: body.joiningDevice,
        joiningEndpointUrl: body.joiningEndpointUrl,
        freshSummary: body.freshSummary,
        allowedHosts,
      });
      response.json({
        ...result,
        proof: request.pairingResponseProof(result),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/complete", authenticateComplete({ database, replayCache, limits: configuredLimits }), (request, response, next) => {
    try {
      const body = requestObject(request.body, "The pairing completion request must be a JSON object.");
      const result = completePairing({
        database,
        getContext,
        invitationId: body.invitationId,
        joiningDeviceId: body.joiningDeviceId,
        sessionNonce: body.sessionNonce,
      });
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.use((error, request, response, next) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    const mapped = mapPairingError(error);
    response.status(mapped.status).json({ error: { code: mapped.code, message: mapped.message } });
  });

  return router;
}

function authenticateAccept({ getContext, replayCache, limits }) {
  return (request, response, next) => {
    try {
      const body = requestObject(request.body, "The pairing request must be a JSON object.");
      const deviceId = request.get("x-fxj-device-id");
      if (!deviceId || body.deviceId !== deviceId || body.joiningDevice?.id !== deviceId) {
        throw new PairingError("PAIRING_AUTH_INVALID", "The pairing device identity is invalid.", 401);
      }
      const publicAuth = normalizePublicAuthentication(body.joiningDevice?.authentication);
      verifyAuthenticatedRequest(request, deviceId, publicAuth.publicKeySpki, replayCache, limits);
      request.pairingResponseProof = (payload) => requestOwnerProof(getContext, payload);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function authenticateComplete({ database, replayCache, limits }) {
  return (request, response, next) => {
    try {
      const body = requestObject(request.body, "The pairing completion request must be a JSON object.");
      if (!isUuid(body.invitationId) || !isUuid(body.joiningDeviceId)) {
        throw new PairingError("PAIRING_SESSION_INVALID", "The pairing session is invalid.", 401);
      }
      const deviceId = request.get("x-fxj-device-id");
      if (!deviceId || deviceId !== body.joiningDeviceId) {
        throw new PairingError("PAIRING_AUTH_INVALID", "The pairing device identity is invalid.", 401);
      }
      const invitation = getPendingPairing(database, body.invitationId);
      if (!invitation || invitation.joiningDeviceId !== deviceId || !invitation.joiningAuthPublicKey) {
        throw new PairingError("PAIRING_SESSION_INVALID", "The pairing session is invalid.", 401);
      }
      const publicAuth = normalizePublicAuthentication({
        algorithm: invitation.joiningAuthAlgorithm,
        publicKeySpki: invitation.joiningAuthPublicKey,
        fingerprint: invitation.joiningAuthKeyFingerprint,
      });
      verifyAuthenticatedRequest(request, deviceId, publicAuth.publicKeySpki, replayCache, limits);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requestOwnerProof(getContext, payload) {
  const owner = getContext();
  if (owner.userId !== payload.workspace?.id || owner.deviceId !== payload.ownerDevice?.id) {
    throw new PairingError("PAIRING_OWNER_MISMATCH", "The pairing response owner does not match this workspace.", 409);
  }
  if (!owner?.auth?.privateKeyPkcs8) {
    throw new PairingError("PAIRING_OWNER_AUTH_UNAVAILABLE", "The workspace owner authentication is unavailable.", 503);
  }
  return signPairingResponse({
    identity: { ...owner.auth, deviceId: owner.deviceId },
    payload,
  });
}

function verifyAuthenticatedRequest(request, deviceId, publicKeySpki, replayCache, limits) {
  const timestamp = request.get("x-fxj-timestamp");
  const requestId = request.get("x-fxj-request-id");
  const signature = request.get("x-fxj-signature");
  const protocolVersion = request.get("x-fxj-protocol-version");
  if (!timestamp || !requestId || !signature || !protocolVersion) {
    throw new PairingError("PAIRING_AUTH_INVALID", "Pairing request authentication is required.", 401);
  }
  if (protocolVersion !== SYNC_AUTH_PROTOCOL_VERSION) {
    throw new PairingError("PROTOCOL_MISMATCH", "The pairing authentication protocol is incompatible.", 409);
  }
  if (!isValidRequestId(requestId)) {
    throw new PairingError("PAIRING_AUTH_INVALID", "The pairing request identity is invalid.", 401);
  }
  const timestampNumber = Number(timestamp);
  if (!Number.isSafeInteger(timestampNumber) || Math.abs(Date.now() - timestampNumber) > limits.authSkewMs) {
    throw new PairingError("PAIRING_AUTH_INVALID", "The pairing authentication timestamp is outside the acceptance window.", 401);
  }
  const body = request.rawBody || Buffer.from(request.body === undefined ? "" : JSON.stringify(request.body));
  let valid = false;
  try {
    valid = verifySyncRequest({
      publicKeySpki,
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
    valid = false;
  }
  if (!valid) throw new PairingError("PAIRING_AUTH_INVALID", "Pairing request authentication failed.", 401);
  pruneReplayCache(replayCache, Date.now() - limits.authSkewMs * 2, limits.replayCacheSize);
  const replayKey = `${deviceId}:${requestId}`;
  if (replayCache.has(replayKey)) throw new PairingError("PAIRING_REPLAY", "The pairing request has already been used.", 409);
  replayCache.set(replayKey, timestampNumber);
}

function normalizePublicAuthentication(authentication) {
  try {
    const normalized = normalizePublicDeviceAuthentication(authentication);
    if (normalized.algorithm !== SYNC_AUTH_ALGORITHM) throw new Error("Unsupported pairing algorithm.");
    return normalized;
  } catch {
    throw new PairingError("PAIRING_AUTH_INVALID", "Only valid public Ed25519 authentication metadata may be provided.", 401);
  }
}

function assertBodyLimit(request, maxBodyBytes) {
  const contentLength = Number(request.get("content-length"));
  if (Number.isSafeInteger(contentLength) && contentLength > maxBodyBytes) {
    throw new PairingError("PAYLOAD_TOO_LARGE", "The pairing request body is too large.", 413);
  }
  if (request.rawBody && request.rawBody.length > maxBodyBytes) {
    throw new PairingError("PAYLOAD_TOO_LARGE", "The pairing request body is too large.", 413);
  }
}

function requestObject(value, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PairingError("PAIRING_REQUEST_INVALID", message, 400);
  return value;
}

function mapPairingError(error) {
  if (error instanceof PairingError) return { status: error.status, code: error.code, message: error.message };
  return { status: 500, code: "PAIRING_INTERNAL_ERROR", message: "The pairing request could not be completed." };
}

function pruneReplayCache(cache, cutoff, maximumSize) {
  for (const [key, timestamp] of cache) {
    if (timestamp < cutoff) cache.delete(key);
  }
  while (cache.size >= maximumSize) cache.delete(cache.keys().next().value);
}
