import fs from "node:fs";
import { assertAdvertisedPeerUrl, assertSyncPeerUrl } from "./syncEndpoints.js";
import { assertFreshNode, adoptJoinedWorkspace } from "./pairingService.js";
import { createSignedRequestHeaders } from "./syncTransportClient.js";
import { verifyPairingResponse } from "./pairingAuth.js";
import { SYNC_AUTH_PROTOCOL_VERSION } from "./syncAuth.js";

export class PairingClientError extends Error {
  constructor(code, message, { status = null, offline = false } = {}) {
    super(message);
    this.name = "PairingClientError";
    this.code = code;
    this.status = status;
    this.offline = offline;
  }
}

export async function acceptPairing({
  database,
  context,
  identityPath,
  token,
  peerUrl,
  ownerFingerprint,
  localEndpoint,
  allowedHosts,
  timeoutMs = 10_000,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") throw new PairingClientError("HTTP_UNAVAILABLE", "The HTTP client is unavailable.");
  if (!context?.auth?.privateKeyPkcs8 || !context.deviceId) {
    throw new PairingClientError("AUTH_FAILED", "Local device authentication is not available.");
  }
  if (typeof token !== "string" || token.length < 16) {
    throw new PairingClientError("PAIRING_TOKEN_INVALID", "A pairing invitation token is required.");
  }
  const normalizedOwnerFingerprint = normalizeFingerprint(ownerFingerprint);
  const peer = assertSyncEndpoint(peerUrl, allowedHosts);
  const advertisedEndpoint = assertAdvertisedEndpoint(localEndpoint);
  const identity = { ...context.auth, deviceId: context.deviceId };
  const pendingStatePath = `${identityPath}.pairing-pending.json`;
  const pendingState = readPendingPairing(pendingStatePath);
  if (pendingState && pendingState.deviceId === context.deviceId && pendingState.workspaceId === context.userId) {
    try {
      const completion = await requestJson({
        fetchImpl,
        peer,
        method: "POST",
        requestPath: "/api/pairing/complete",
        body: {
          invitationId: pendingState.invitationId,
          joiningDeviceId: context.deviceId,
          sessionNonce: pendingState.sessionNonce,
        },
        identity,
        timeoutMs,
      });
      clearPendingPairing(pendingStatePath);
      return {
        ok: true,
        resumed: true,
        adoption: {
          deviceId: context.deviceId,
          workspaceId: context.userId,
          ownerDeviceId: pendingState.ownerDeviceId,
          ownerFingerprint: pendingState.ownerFingerprint,
          endpointUrl: pendingState.peerUrl,
        },
        completion,
      };
    } catch (error) {
      if (error.code !== "PAIRING_ALREADY_COMPLETED") throw error;
      clearPendingPairing(pendingStatePath);
      return {
        ok: true,
        resumed: true,
        adoption: {
          deviceId: context.deviceId,
          workspaceId: context.userId,
          ownerDeviceId: pendingState.ownerDeviceId,
          ownerFingerprint: pendingState.ownerFingerprint,
          endpointUrl: pendingState.peerUrl,
        },
        completion: { ok: true, alreadyCompleted: true },
      };
    }
  }
  if (pendingState) clearPendingPairing(pendingStatePath);
  const freshSummary = assertFreshNode(database, context);
  const joiningDevice = {
    id: context.deviceId,
    name: context.device?.name || "FXJourney Local Device",
    platform: context.device?.platform || process.platform,
    appVersion: context.device?.appVersion || null,
    authentication: {
      algorithm: context.auth.algorithm,
      publicKeySpki: context.auth.publicKeySpki,
      fingerprint: context.auth.fingerprint,
    },
  };
  const acceptBody = {
    deviceId: context.deviceId,
    token,
    joiningDevice,
    joiningEndpointUrl: advertisedEndpoint.toString(),
    freshSummary,
  };
  const acceptResponse = await requestJson({
    fetchImpl,
    peer,
    method: "POST",
    requestPath: "/api/pairing/accept",
    body: acceptBody,
    identity,
    timeoutMs,
  });
  const { proof, ...payload } = acceptResponse;
  const ownerDevice = payload.ownerDevice;
  if (!ownerDevice || normalizeFingerprint(ownerDevice.authKeyFingerprint) !== normalizedOwnerFingerprint) {
    throw new PairingClientError("PAIRING_OWNER_MISMATCH", "The pairing response owner fingerprint did not match the confirmed fingerprint.", { status: 409 });
  }
  if (proof?.protocolVersion !== SYNC_AUTH_PROTOCOL_VERSION) {
    throw new PairingClientError("PAIRING_RESPONSE_INVALID", "The pairing response proof is invalid.", { status: 502 });
  }
  let validProof = false;
  try {
    validProof = verifyPairingResponse({
      payload,
      proof,
      publicKeySpki: ownerDevice.authPublicKey,
      deviceId: ownerDevice.id,
    });
  } catch {
    validProof = false;
  }
  if (!validProof) throw new PairingClientError("PAIRING_RESPONSE_INVALID", "The pairing response could not be authenticated.", { status: 502 });

  writePendingPairing(pendingStatePath, {
    invitationId: payload.invitationId,
    sessionNonce: payload.sessionNonce,
    deviceId: context.deviceId,
    workspaceId: payload.workspace.id,
    ownerDeviceId: ownerDevice.id,
    ownerFingerprint: normalizedOwnerFingerprint,
    peerUrl: peer.toString(),
  });
  const adoption = adoptJoinedWorkspace({
    database,
    identityPath,
    context,
    payload,
    peerUrl: peer.toString(),
    localEndpoint: advertisedEndpoint.toString(),
    allowedHosts,
    ownerFingerprint: normalizedOwnerFingerprint,
  });
  const completeBody = {
    invitationId: payload.invitationId,
    joiningDeviceId: context.deviceId,
    sessionNonce: payload.sessionNonce,
  };
  const completion = await requestJson({
    fetchImpl,
    peer,
    method: "POST",
    requestPath: "/api/pairing/complete",
    body: completeBody,
    identity,
    timeoutMs,
  });
  clearPendingPairing(pendingStatePath);
  return { ok: true, adoption, completion, ownerDevice };
}

function assertSyncEndpoint(value, allowedHosts) {
  try {
    return assertSyncPeerUrl(value, { allowedHosts });
  } catch (error) {
    throw new PairingClientError(error.code || "INVALID_PEER_URL", error.message);
  }
}

function assertAdvertisedEndpoint(value) {
  try {
    return assertAdvertisedPeerUrl(value);
  } catch (error) {
    throw new PairingClientError(error.code || "INVALID_ADVERTISED_ENDPOINT", error.message);
  }
}

function normalizeFingerprint(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new PairingClientError("PAIRING_OWNER_FINGERPRINT_INVALID", "A valid owner device fingerprint is required.");
  }
  return normalized;
}

async function requestJson({ fetchImpl, peer, method, requestPath, body, identity, timeoutMs }) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(new URL(requestPath, peer), {
      method,
      headers: {
        Accept: "application/json",
        "content-type": "application/json",
        "content-length": String(rawBody.length),
        ...createSignedRequestHeaders({ identity, method, path: requestPath, rawBody }),
      },
      body: rawBody,
      signal: controller.signal,
    });
    const text = await response.text();
    let responseBody = null;
    try {
      responseBody = text ? JSON.parse(text) : null;
    } catch {
      throw new PairingClientError("INVALID_RESPONSE", "The pairing peer returned an invalid response.", { status: response.status });
    }
    if (!response.ok) {
      const remoteError = responseBody?.error;
      throw new PairingClientError(
        remoteError?.code || "PAIRING_FAILED",
        remoteError?.message || "The pairing peer rejected the request.",
        { status: response.status, offline: response.status >= 500 },
      );
    }
    return responseBody;
  } catch (error) {
    if (error instanceof PairingClientError) throw error;
    throw new PairingClientError(
      controller.signal.aborted ? "PEER_TIMEOUT" : "PEER_UNAVAILABLE",
      controller.signal.aborted ? "The pairing peer request timed out." : "The pairing peer is unavailable.",
      { offline: true },
    );
  } finally {
    clearTimeout(timeout);
  }
}

function readPendingPairing(filename) {
  try {
    const value = JSON.parse(fs.readFileSync(filename, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function writePendingPairing(filename, state) {
  const temporaryPath = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  try {
    fs.renameSync(temporaryPath, filename);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
}

function clearPendingPairing(filename) {
  try { fs.rmSync(filename, { force: true }); } catch { /* best effort cleanup */ }
}
