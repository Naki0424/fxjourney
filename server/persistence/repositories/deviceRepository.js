function mapDevice(row) {
  return row ? { ...row } : null;
}

export function findDeviceById(database, id) {
  return mapDevice(database.prepare("SELECT * FROM devices WHERE id = ?").get(id));
}

export function findFirstActiveDevice(database) {
  return mapDevice(database.prepare(
    "SELECT * FROM devices WHERE retiredAt IS NULL ORDER BY createdAt ASC, id ASC LIMIT 1",
  ).get());
}

export function insertDevice(database, device) {
  database.prepare(`
    INSERT INTO devices (
      id, userId, name, platform, appVersion, createdAt, lastSeenAt, retiredAt,
      authAlgorithm, authPublicKey, authKeyFingerprint, trustedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    device.id,
    device.userId,
    device.name,
    device.platform,
    device.appVersion,
    device.createdAt,
    device.lastSeenAt,
    device.retiredAt,
    device.authAlgorithm ?? null,
    device.authPublicKey ?? null,
    device.authKeyFingerprint ?? null,
    device.trustedAt ?? null,
  );
  return findDeviceById(database, device.id);
}

export function updateDeviceAuthentication(database, deviceId, authentication) {
  database.prepare(`
    UPDATE devices SET
      authAlgorithm = ?, authPublicKey = ?, authKeyFingerprint = ?, trustedAt = COALESCE(trustedAt, ?)
    WHERE id = ?
  `).run(
    authentication.algorithm,
    authentication.publicKeySpki,
    authentication.fingerprint,
    authentication.trustedAt,
    deviceId,
  );
  return findDeviceById(database, deviceId);
}

export function touchDevice(database, id, lastSeenAt) {
  database.prepare("UPDATE devices SET lastSeenAt = ? WHERE id = ? AND retiredAt IS NULL").run(lastSeenAt, id);
  return findDeviceById(database, id);
}
