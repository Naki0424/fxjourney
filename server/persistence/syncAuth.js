import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { isUuid } from "./utils.js";

export const SYNC_AUTH_ALGORITHM = "ed25519";
export const SYNC_AUTH_PROTOCOL_VERSION = "1";
export const SYNC_AUTH_MESSAGE_PREFIX = "FXJOURNEY-SYNC-AUTH-V1";

export function createDeviceAuthentication() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privateKeyPkcs8 = privateKey.export({ format: "der", type: "pkcs8" });
  const publicKeySpki = publicKey.export({ format: "der", type: "spki" });
  return {
    algorithm: SYNC_AUTH_ALGORITHM,
    privateKeyPkcs8: privateKeyPkcs8.toString("base64"),
    publicKeySpki: publicKeySpki.toString("base64"),
    fingerprint: fingerprint(publicKeySpki),
  };
}

export function normalizeDeviceAuthentication(authentication) {
  if (!authentication?.privateKeyPkcs8) return createDeviceAuthentication();
  if (authentication.algorithm && authentication.algorithm !== SYNC_AUTH_ALGORITHM) {
    throw new Error("Unsupported local device authentication algorithm.");
  }

  const privateKeyDer = Buffer.from(authentication.privateKeyPkcs8, "base64");
  const privateKey = createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey);
  const publicKeySpki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const derivedFingerprint = fingerprint(publicKeySpki);
  if (authentication.publicKeySpki && authentication.publicKeySpki !== publicKeySpki) {
    throw new Error("Local device authentication key pair is inconsistent.");
  }
  if (authentication.fingerprint && authentication.fingerprint !== derivedFingerprint) {
    throw new Error("Local device authentication fingerprint is inconsistent.");
  }
  return {
    algorithm: SYNC_AUTH_ALGORITHM,
    privateKeyPkcs8: authentication.privateKeyPkcs8,
    publicKeySpki,
    fingerprint: derivedFingerprint,
  };
}

export function fingerprint(publicKeySpki) {
  return createHash("sha256").update(Buffer.from(publicKeySpki, "base64")).digest("hex");
}

export function requestBodyHash(rawBody = Buffer.alloc(0)) {
  return createHash("sha256").update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody))).digest("hex");
}

export function buildAuthenticatedMessage({ method, path, timestamp, requestId, bodyHash, deviceId, protocolVersion = SYNC_AUTH_PROTOCOL_VERSION }) {
  // Exact signed bytes: PREFIX, METHOD, PATH, timestamp, requestId, body
  // SHA-256, deviceId, and protocol version separated by LF characters.
  return [
    SYNC_AUTH_MESSAGE_PREFIX,
    String(method).toUpperCase(),
    normalizeRequestPath(path),
    String(timestamp),
    String(requestId),
    String(bodyHash),
    String(deviceId),
    String(protocolVersion),
  ].join("\n");
}

export function signSyncRequest({ privateKeyPkcs8, method, path, timestamp, requestId, bodyHash, deviceId, protocolVersion }) {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return sign(
    null,
    Buffer.from(buildAuthenticatedMessage({ method, path, timestamp, requestId, bodyHash, deviceId, protocolVersion })),
    privateKey,
  ).toString("base64");
}

export function verifySyncRequest({ publicKeySpki, signature, method, path, timestamp, requestId, bodyHash, deviceId, protocolVersion }) {
  const publicKey = createPublicKey({
    key: Buffer.from(publicKeySpki, "base64"),
    format: "der",
    type: "spki",
  });
  return verify(
    null,
    Buffer.from(buildAuthenticatedMessage({ method, path, timestamp, requestId, bodyHash, deviceId, protocolVersion })),
    publicKey,
    Buffer.from(signature, "base64"),
  );
}

export function normalizeRequestPath(path) {
  const value = String(path || "");
  if (!value.startsWith("/")) throw new Error("Authenticated request path must be absolute.");
  return value;
}

export function isValidRequestId(value) {
  return isUuid(value);
}
