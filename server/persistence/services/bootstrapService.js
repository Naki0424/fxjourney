import os from "node:os";
import { randomUUID } from "node:crypto";
import { findDeviceById, findFirstActiveDevice, insertDevice, touchDevice, updateDeviceAuthentication } from "../repositories/deviceRepository.js";
import { findUserProfileById, insertUserProfile } from "../repositories/userProfileRepository.js";
import { listActiveAccountsByUserId } from "../repositories/accountRepository.js";
import { readLocalIdentity, resolveIdentityPath, writeLocalIdentity } from "../identity.js";
import { createId, nowUtc, withTransaction } from "../utils.js";
import { normalizeDeviceAuthentication } from "../syncAuth.js";

const DEFAULT_DISPLAY_NAME = "John Trader";
const DEFAULT_DEVICE_NAME = "FXJourney Local Device";

export function bootstrapLocalInstallation({ database, identityPath } = {}) {
  const resolvedIdentityPath = resolveIdentityPath(identityPath);
  const storedIdentity = readLocalIdentity(resolvedIdentityPath);
  const storedDevice = storedIdentity ? findDeviceById(database, storedIdentity.deviceId) : null;
  const fallbackDevice = storedIdentity || storedDevice ? null : findFirstActiveDevice(database);
  const deviceId = storedIdentity?.deviceId || fallbackDevice?.id || randomUUID();
  const userId = storedIdentity?.userId || storedDevice?.userId || fallbackDevice?.userId || createId();
  const authentication = normalizeDeviceAuthentication(storedIdentity?.auth);
  const timestamp = nowUtc();
  let profile;
  let device;

  withTransaction(database, () => {
    device = findDeviceById(database, deviceId);
    const effectiveUserId = device?.userId || userId;
    profile = findUserProfileById(database, effectiveUserId);
    if (!profile) {
      profile = insertUserProfile(database, {
        id: effectiveUserId,
        displayName: process.env.FXJOURNEY_DISPLAY_NAME?.trim() || DEFAULT_DISPLAY_NAME,
        avatarMediaId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        version: 1,
        originDeviceId: deviceId,
        lastModifiedByDeviceId: deviceId,
      });
    }

    if (!device) {
      device = insertDevice(database, {
        id: deviceId,
        userId: profile.id,
        name: DEFAULT_DEVICE_NAME,
        platform: process.platform || os.platform(),
        appVersion: process.env.FXJOURNEY_APP_VERSION?.trim() || null,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        retiredAt: null,
        authAlgorithm: authentication.algorithm,
        authPublicKey: authentication.publicKeySpki,
        authKeyFingerprint: authentication.fingerprint,
        trustedAt: timestamp,
      });
    } else {
      if (device.authPublicKey && (device.authPublicKey !== authentication.publicKeySpki || device.authKeyFingerprint !== authentication.fingerprint)) {
        throw new Error("Local device authentication does not match its registered identity.");
      }
      device = updateDeviceAuthentication(database, device.id, {
        ...authentication,
        trustedAt: timestamp,
      });
      device = touchDevice(database, device.id, timestamp);
    }
  });

  const canonicalIdentity = { deviceId: device.id, userId: profile.id, auth: authentication };
  if (!storedIdentity || storedIdentity.deviceId !== canonicalIdentity.deviceId || storedIdentity.userId !== canonicalIdentity.userId || JSON.stringify(storedIdentity.auth) !== JSON.stringify(authentication)) {
    writeLocalIdentity(canonicalIdentity, resolvedIdentityPath);
  }

  return {
    userId: profile.id,
    deviceId: device.id,
    userProfile: profile,
    device,
    auth: authentication,
    getBootstrap() {
      return {
        userProfile: findUserProfileById(database, profile.id),
        device: findDeviceById(database, device.id),
        accounts: listActiveAccountsByUserId(database, profile.id),
      };
    },
  };
}
