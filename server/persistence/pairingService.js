import { createHash, randomBytes } from "node:crypto";
import { findDeviceById, insertDevice, trustDeviceAuthentication, updateDeviceWorkspace } from "./repositories/deviceRepository.js";
import { findUserProfileById, insertUserProfile } from "./repositories/userProfileRepository.js";
import { upsertSyncPeer } from "./syncPeerRepository.js";
import { normalizePublicDeviceAuthentication } from "./syncAuth.js";
import { assertAdvertisedPeerUrl, assertSyncPeerUrl, SyncEndpointError } from "./syncEndpoints.js";
import { createId, isUuid, nowUtc, withTransaction } from "./utils.js";
import { writeLocalIdentity } from "./identity.js";

export const DEFAULT_PAIRING_TTL_MS = 10 * 60 * 1000;

export class PairingError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "PairingError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const USER_DATA_TABLES = [
  "app_settings",
  "accounts",
  "trades",
  "media_assets",
  "screenshot_folders",
  "categories",
  "tags",
  "journal_entries",
  "goals",
  "habits",
  "weekly_reflections",
  "analysis_sessions",
];

export function createPairingInvitation({ database, getContext, expiresInMs = DEFAULT_PAIRING_TTL_MS } = {}) {
  const context = getContext();
  const ttl = Number(expiresInMs);
  if (!Number.isSafeInteger(ttl) || ttl < 60_000 || ttl > 24 * 60 * 60 * 1000) {
    throw new PairingError("PAIRING_EXPIRY_INVALID", "Pairing expiry must be between one minute and 24 hours.");
  }
  const createdAt = nowUtc();
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const token = randomBytes(32).toString("base64url");
  const id = createId();
  withTransaction(database, () => {
    database.prepare(`
      INSERT INTO sync_pairing_invitations (
        id, userId, ownerDeviceId, tokenHash, createdAt, expiresAt
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, context.userId, context.deviceId, hashSecret(token), createdAt, expiresAt);
  });
  return {
    invitationId: id,
    token,
    createdAt,
    expiresAt,
    workspaceId: context.userId,
    ownerDeviceId: context.deviceId,
    ownerFingerprint: context.auth.fingerprint,
  };
}

export function getFreshNodeSummary(database, { userId, deviceId } = {}) {
  const counts = {};
  for (const table of USER_DATA_TABLES) {
    counts[table] = database.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE userId = ?`).get(userId).count;
  }
  counts.sync_changes = database.prepare(
    "SELECT COUNT(*) AS count FROM sync_changes WHERE originDeviceId = ? OR receivedFromDeviceId = ?",
  ).get(deviceId, deviceId).count;
  counts.sync_state = database.prepare(
    "SELECT COUNT(*) AS count FROM sync_state WHERE localDeviceId = ? OR remoteDeviceId = ?",
  ).get(deviceId, deviceId).count;
  counts.sync_conflicts = database.prepare(
    "SELECT COUNT(*) AS count FROM sync_conflicts WHERE localDeviceId = ? OR remoteDeviceId = ?",
  ).get(deviceId, deviceId).count;
  counts.sync_device_sequences = database.prepare(
    "SELECT COUNT(*) AS count FROM sync_device_sequences WHERE deviceId = ?",
  ).get(deviceId).count;
  counts.sync_change_receipts = database.prepare(
    "SELECT COUNT(*) AS count FROM sync_change_receipts WHERE localDeviceId = ? OR remoteDeviceId = ?",
  ).get(deviceId, deviceId).count;
  counts.sync_pending_changes = database.prepare(
    "SELECT COUNT(*) AS count FROM sync_pending_changes WHERE localDeviceId = ? OR remoteDeviceId = ?",
  ).get(deviceId, deviceId).count;
  const otherDevices = database.prepare(
    "SELECT COUNT(*) AS count FROM devices WHERE userId = ? AND id <> ?",
  ).get(userId, deviceId).count;
  const total = Object.values(counts).reduce((sum, count) => sum + Number(count), 0);
  return {
    isFresh: total === 0 && otherDevices === 0,
    total,
    otherDevices,
    counts,
  };
}

export function assertFreshNode(database, context) {
  const summary = getFreshNodeSummary(database, context);
  if (!summary.isFresh) {
    throw new PairingError(
      "PAIRING_NODE_NOT_FRESH",
      "The joining device contains local data and cannot be adopted into another workspace.",
      409,
      { summary },
    );
  }
  return summary;
}

export function preparePairing({ database, getContext, token, joiningDevice, joiningEndpointUrl, freshSummary, allowedHosts } = {}) {
  const owner = getContext();
  const invitation = database.prepare(
    "SELECT * FROM sync_pairing_invitations WHERE tokenHash = ?",
  ).get(hashSecret(token));
  if (!invitation) throw new PairingError("PAIRING_TOKEN_INVALID", "The pairing invitation is invalid.", 401);
  if (invitation.completedAt || invitation.consumedAt) {
    throw new PairingError("PAIRING_ALREADY_COMPLETED", "The pairing invitation has already been consumed.", 409);
  }
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    throw new PairingError("PAIRING_EXPIRED", "The pairing invitation has expired.", 410);
  }
  if (invitation.userId !== owner.userId || invitation.ownerDeviceId !== owner.deviceId) {
    throw new PairingError("PAIRING_OWNER_MISMATCH", "The pairing invitation does not belong to this workspace.", 409);
  }

  const joining = normalizeJoiningDevice(joiningDevice);
  if (joining.id === owner.deviceId) throw new PairingError("PAIRING_DEVICE_INVALID", "The owner device cannot pair with itself.");
  const endpointUrl = parsePeerEndpoint(joiningEndpointUrl, allowedHosts);
  validateFreshSummary(freshSummary);
  if (invitation.joiningDeviceId && invitation.joiningDeviceId !== joining.id) {
    throw new PairingError("PAIRING_DEVICE_MISMATCH", "This invitation is already reserved for another device.", 409);
  }
  if (invitation.joiningAuthKeyFingerprint && invitation.joiningAuthKeyFingerprint !== joining.auth.fingerprint) {
    throw new PairingError("PAIRING_DEVICE_MISMATCH", "This invitation is already reserved for another device key.", 409);
  }
  if (invitation.joiningEndpointUrl && invitation.joiningEndpointUrl !== endpointUrl) {
    throw new PairingError("PAIRING_ENDPOINT_MISMATCH", "This invitation is already reserved for another peer endpoint.", 409);
  }

  const existing = findDeviceById(database, joining.id);
  if (existing && existing.userId !== owner.userId) {
    throw new PairingError("DEVICE_ID_COLLISION", "The joining device ID belongs to another workspace.", 409);
  }
  if (existing?.retiredAt) throw new PairingError("DEVICE_RETIRED", "The joining device is retired.", 409);
  if (existing?.trustedAt) {
    throw new PairingError("DEVICE_ALREADY_TRUSTED", "The joining device is already trusted and cannot be paired with this invitation.", 409);
  }

  const sessionNonce = randomBytes(32).toString("base64url");
  const timestamp = nowUtc();
  withTransaction(database, () => {
    if (!existing) {
      insertDevice(database, {
        id: joining.id,
        userId: owner.userId,
        name: joining.name,
        platform: joining.platform,
        appVersion: joining.appVersion,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        retiredAt: null,
        authAlgorithm: joining.auth.algorithm,
        authPublicKey: joining.auth.publicKeySpki,
        authKeyFingerprint: joining.auth.fingerprint,
        trustedAt: null,
      });
    } else {
      database.prepare(`
        UPDATE devices SET name = ?, platform = ?, appVersion = ?, lastSeenAt = ?,
          authAlgorithm = ?, authPublicKey = ?, authKeyFingerprint = ?
        WHERE id = ? AND trustedAt IS NULL
      `).run(
        joining.name,
        joining.platform,
        joining.appVersion,
        timestamp,
        joining.auth.algorithm,
        joining.auth.publicKeySpki,
        joining.auth.fingerprint,
        joining.id,
      );
    }
    database.prepare(`
      UPDATE sync_pairing_invitations SET
        acceptedAt = COALESCE(acceptedAt, ?), joiningDeviceId = ?,
        joiningAuthAlgorithm = ?, joiningAuthPublicKey = ?, joiningAuthKeyFingerprint = ?,
        joiningEndpointUrl = ?, sessionNonceHash = ?
      WHERE id = ?
    `).run(
      timestamp,
      joining.id,
      joining.auth.algorithm,
      joining.auth.publicKeySpki,
      joining.auth.fingerprint,
      endpointUrl,
      hashSecret(sessionNonce),
      invitation.id,
    );
  });

  const ownerDevice = findDeviceById(database, owner.deviceId);
  const profile = findUserProfileById(database, owner.userId);
  return {
    ok: true,
    invitationId: invitation.id,
    joiningDeviceId: joining.id,
    sessionNonce,
    expiresAt: invitation.expiresAt,
    workspace: {
      id: profile.id,
      displayName: profile.displayName,
      version: profile.version,
    },
    ownerDevice: publicDevice(ownerDevice),
  };
}

export function getPendingPairing(database, invitationId) {
  return database.prepare(
    "SELECT * FROM sync_pairing_invitations WHERE id = ?",
  ).get(invitationId) || null;
}

export function completePairing({ database, getContext, invitationId, joiningDeviceId, sessionNonce } = {}) {
  const owner = getContext();
  const invitation = getPendingPairing(database, invitationId);
  if (!invitation || invitation.userId !== owner.userId || invitation.ownerDeviceId !== owner.deviceId) {
    throw new PairingError("PAIRING_OWNER_MISMATCH", "The pairing session does not belong to this workspace owner.", 409);
  }
  if (!invitation?.joiningDeviceId || invitation.joiningDeviceId !== joiningDeviceId) {
    throw new PairingError("PAIRING_SESSION_INVALID", "The pairing session is invalid.", 409);
  }
  if (invitation.completedAt || invitation.consumedAt) {
    throw new PairingError("PAIRING_ALREADY_COMPLETED", "The pairing invitation has already been consumed.", 409);
  }
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    throw new PairingError("PAIRING_EXPIRED", "The pairing session has expired.", 410);
  }
  if (hashSecret(sessionNonce) !== invitation.sessionNonceHash) {
    throw new PairingError("PAIRING_SESSION_INVALID", "The pairing session proof is invalid.", 401);
  }
  const device = findDeviceById(database, joiningDeviceId);
  if (!device || device.userId !== owner.userId || device.authKeyFingerprint !== invitation.joiningAuthKeyFingerprint) {
    throw new PairingError("PAIRING_SESSION_INVALID", "The joining device registration is invalid.", 409);
  }
  const timestamp = nowUtc();
  withTransaction(database, () => {
    trustDeviceAuthentication(database, joiningDeviceId, {
      algorithm: invitation.joiningAuthAlgorithm,
      publicKeySpki: invitation.joiningAuthPublicKey,
      fingerprint: invitation.joiningAuthKeyFingerprint,
    }, timestamp);
    database.prepare(`
      UPDATE sync_pairing_invitations SET completedAt = ?, consumedAt = ?, sessionNonceHash = NULL
      WHERE id = ? AND completedAt IS NULL
    `).run(timestamp, timestamp, invitation.id);
    upsertSyncPeer(database, {
      id: createId(),
      localDeviceId: owner.deviceId,
      peerDeviceId: joiningDeviceId,
      endpointUrl: invitation.joiningEndpointUrl,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastSyncAt: null,
    });
  });
  return {
    ok: true,
    invitationId: invitation.id,
    deviceId: joiningDeviceId,
    workspaceId: owner.userId,
    completedAt: timestamp,
  };
}

export function adoptJoinedWorkspace({ database, identityPath, context, payload, peerUrl, localEndpoint, allowedHosts, ownerFingerprint } = {}) {
  const workspaceId = payload?.workspace?.id;
  const ownerDevice = payload?.ownerDevice;
  if (!workspaceId || !ownerDevice || payload.joiningDeviceId !== context.deviceId) {
    throw new PairingError("PAIRING_RESPONSE_INVALID", "The pairing response is incomplete.", 502);
  }
  const ownerAuth = normalizePublicAuth(ownerDevice);
  if (ownerFingerprint && ownerAuth.fingerprint !== ownerFingerprint.toLowerCase()) {
    throw new PairingError("PAIRING_OWNER_MISMATCH", "The pairing response fingerprint does not match the confirmed owner fingerprint.", 409);
  }
  const endpointUrl = parsePeerEndpoint(peerUrl, allowedHosts);
  parseAdvertisedEndpoint(localEndpoint);
  assertFreshNode(database, context);
  const oldIdentity = {
    deviceId: context.deviceId,
    userId: context.userId,
    auth: context.auth,
  };
  const timestamp = nowUtc();
  let identityWritten = false;
  try {
    withTransaction(database, () => {
      const localDevice = findDeviceById(database, context.deviceId);
      if (!localDevice || localDevice.authKeyFingerprint !== context.auth.fingerprint) {
        throw new PairingError("PAIRING_LOCAL_IDENTITY_INVALID", "The local device identity does not match its database registration.", 409);
      }
      const existingWorkspace = findUserProfileById(database, workspaceId);
      if (!existingWorkspace) {
        insertUserProfile(database, {
          id: workspaceId,
          displayName: String(payload.workspace.displayName || "John Trader").slice(0, 200),
          avatarMediaId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          version: Number.isSafeInteger(payload.workspace.version) ? payload.workspace.version : 1,
          originDeviceId: ownerDevice.id,
          lastModifiedByDeviceId: ownerDevice.id,
        });
      }
      if (context.userId !== workspaceId) {
        updateDeviceWorkspace(database, context.deviceId, workspaceId);
        database.prepare("DELETE FROM user_profiles WHERE id = ?").run(context.userId);
      }
      const existingOwner = findDeviceById(database, ownerDevice.id);
      if (existingOwner && (existingOwner.userId !== workspaceId || (existingOwner.authKeyFingerprint && existingOwner.authKeyFingerprint !== ownerAuth.fingerprint))) {
        throw new PairingError("DEVICE_ID_COLLISION", "The owner device registration conflicts with the pairing response.", 409);
      }
      if (!existingOwner) {
        insertDevice(database, {
          id: ownerDevice.id,
          userId: workspaceId,
          name: ownerDevice.name,
          platform: ownerDevice.platform,
          appVersion: ownerDevice.appVersion,
          createdAt: ownerDevice.createdAt || timestamp,
          lastSeenAt: ownerDevice.lastSeenAt || timestamp,
          retiredAt: null,
          authAlgorithm: ownerAuth.algorithm,
          authPublicKey: ownerAuth.publicKeySpki,
          authKeyFingerprint: ownerAuth.fingerprint,
          trustedAt: timestamp,
        });
      } else if (existingOwner.retiredAt) {
        throw new PairingError("DEVICE_RETIRED", "The owner device is retired.", 409);
      } else {
        trustDeviceAuthentication(database, ownerDevice.id, ownerAuth, existingOwner.trustedAt || timestamp);
      }
      upsertSyncPeer(database, {
        id: createId(),
        localDeviceId: context.deviceId,
        peerDeviceId: ownerDevice.id,
        endpointUrl,
        createdAt: timestamp,
        updatedAt: timestamp,
        lastSyncAt: null,
      });
      writeIdentityForPairing({ deviceId: context.deviceId, userId: workspaceId, auth: context.auth }, identityPath);
      identityWritten = true;
    });
  } catch (error) {
    if (identityWritten) {
      try { writeIdentityForPairing(oldIdentity, identityPath); } catch { /* bootstrap repairs identity on next startup */ }
    }
    throw error;
  }
  return {
    deviceId: context.deviceId,
    workspaceId,
    ownerDeviceId: ownerDevice.id,
    ownerFingerprint: ownerAuth.fingerprint,
    endpointUrl,
  };
}

function normalizeJoiningDevice(device) {
  if (!device || typeof device !== "object" || !isUuid(device.id)) {
    throw new PairingError("PAIRING_DEVICE_INVALID", "The joining device identity is invalid.");
  }
  return {
    id: device.id,
    name: boundedText(device.name, "Device name", 160),
    platform: boundedText(device.platform, "Device platform", 80),
    appVersion: device.appVersion ? boundedText(device.appVersion, "Device app version", 80) : null,
    auth: normalizePublicAuth(device.authentication),
  };
}

function normalizePublicAuth(authentication) {
  try {
    return normalizePublicDeviceAuthentication({
      algorithm: authentication?.algorithm || authentication?.authAlgorithm,
      publicKeySpki: authentication?.publicKeySpki || authentication?.authPublicKey,
      fingerprint: authentication?.fingerprint || authentication?.authKeyFingerprint,
    });
  } catch {
    throw new PairingError("PAIRING_AUTH_INVALID", "The device public authentication metadata is invalid.", 401);
  }
}

function parsePeerEndpoint(value, allowedHosts) {
  try {
    return assertSyncPeerUrl(value, { allowedHosts }).toString();
  } catch (error) {
    if (error instanceof SyncEndpointError) throw new PairingError(error.code, error.message, 400);
    throw error;
  }
}

function parseAdvertisedEndpoint(value) {
  try {
    return assertAdvertisedPeerUrl(value).toString();
  } catch (error) {
    if (error instanceof SyncEndpointError) throw new PairingError(error.code, error.message, 400);
    throw error;
  }
}

function validateFreshSummary(summary) {
  if (!summary || summary.isFresh !== true || summary.total !== 0 || summary.otherDevices !== 0) {
    throw new PairingError("PAIRING_NODE_NOT_FRESH", "The joining device did not prove that it is an empty fresh node.", 409);
  }
}

function publicDevice(device) {
  return {
    id: device.id,
    userId: device.userId,
    name: device.name,
    platform: device.platform,
    appVersion: device.appVersion,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt,
    retiredAt: device.retiredAt,
    authAlgorithm: device.authAlgorithm,
    authPublicKey: device.authPublicKey,
    authKeyFingerprint: device.authKeyFingerprint,
  };
}

function boundedText(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new PairingError("PAIRING_DEVICE_INVALID", `${field} is invalid.`);
  }
  return value.trim();
}

function hashSecret(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 512) {
    throw new PairingError("PAIRING_TOKEN_INVALID", "The pairing secret is invalid.", 401);
  }
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function writeIdentityForPairing(identity, identityPath) {
  writeLocalIdentity(identity, identityPath);
}
