import os from "node:os";
import { randomUUID } from "node:crypto";
import { findDeviceById, findFirstActiveDevice, insertDevice, touchDevice } from "../repositories/deviceRepository.js";
import { findUserProfileById, insertUserProfile } from "../repositories/userProfileRepository.js";
import { listActiveAccountsByUserId } from "../repositories/accountRepository.js";
import { readLocalIdentity, resolveIdentityPath, writeLocalIdentity } from "../identity.js";
import { createId, nowUtc, withTransaction } from "../utils.js";

const DEFAULT_DISPLAY_NAME = "John Trader";
const DEFAULT_DEVICE_NAME = "FXJourney Local Device";

export function bootstrapLocalInstallation({ database, identityPath } = {}) {
  const resolvedIdentityPath = resolveIdentityPath(identityPath);
  const storedIdentity = readLocalIdentity(resolvedIdentityPath);
  const storedDevice = storedIdentity ? findDeviceById(database, storedIdentity.deviceId) : null;
  const fallbackDevice = storedIdentity || storedDevice ? null : findFirstActiveDevice(database);
  const deviceId = storedIdentity?.deviceId || fallbackDevice?.id || randomUUID();
  const userId = storedIdentity?.userId || storedDevice?.userId || fallbackDevice?.userId || createId();
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
      });
    } else {
      device = touchDevice(database, device.id, timestamp);
    }
  });

  const canonicalIdentity = { deviceId: device.id, userId: profile.id };
  if (!storedIdentity || storedIdentity.deviceId !== canonicalIdentity.deviceId || storedIdentity.userId !== canonicalIdentity.userId) {
    writeLocalIdentity(canonicalIdentity, resolvedIdentityPath);
  }

  return {
    userId: profile.id,
    deviceId: device.id,
    userProfile: profile,
    device,
    getBootstrap() {
      return {
        userProfile: findUserProfileById(database, profile.id),
        device: findDeviceById(database, device.id),
        accounts: listActiveAccountsByUserId(database, profile.id),
      };
    },
  };
}
