import { randomUUID } from "node:crypto";
import {
  SYNC_AUTH_PROTOCOL_VERSION,
  isValidRequestId,
  requestBodyHash,
  signSyncRequest,
  verifySyncRequest,
} from "./syncAuth.js";

export const PAIRING_RESPONSE_METHOD = "PAIRING_RESPONSE";

export function canonicalPairingJson(value) {
  return JSON.stringify(sortPairingValue(value));
}

export function signPairingResponse({ identity, payload, timestamp = Date.now().toString(), requestId = randomUUID() }) {
  const rawBody = Buffer.from(canonicalPairingJson(payload));
  return {
    timestamp,
    requestId,
    protocolVersion: SYNC_AUTH_PROTOCOL_VERSION,
    signature: signSyncRequest({
      privateKeyPkcs8: identity.privateKeyPkcs8,
      method: PAIRING_RESPONSE_METHOD,
      path: "/api/pairing/accept",
      timestamp,
      requestId,
      bodyHash: requestBodyHash(rawBody),
      deviceId: identity.deviceId,
      protocolVersion: SYNC_AUTH_PROTOCOL_VERSION,
    }),
  };
}

export function verifyPairingResponse({ payload, proof, publicKeySpki, deviceId, maxSkewMs = 5 * 60 * 1000 }) {
  const timestamp = Number(proof?.timestamp);
  if (
    proof?.protocolVersion !== SYNC_AUTH_PROTOCOL_VERSION
    || !Number.isSafeInteger(timestamp)
    || Math.abs(Date.now() - timestamp) > maxSkewMs
    || !isValidRequestId(proof?.requestId)
    || !proof?.signature
  ) return false;
  const rawBody = Buffer.from(canonicalPairingJson(payload));
  return verifySyncRequest({
    publicKeySpki,
    signature: proof.signature,
    method: PAIRING_RESPONSE_METHOD,
    path: "/api/pairing/accept",
    timestamp: proof.timestamp,
    requestId: proof.requestId,
    bodyHash: requestBodyHash(rawBody),
    deviceId,
    protocolVersion: proof.protocolVersion,
  });
}

function sortPairingValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(sortPairingValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortPairingValue(value[key])]));
  }
  return null;
}
