function mapUserProfile(row) {
  return row ? { ...row } : null;
}

export function findUserProfileById(database, id) {
  return mapUserProfile(database.prepare("SELECT * FROM user_profiles WHERE id = ?").get(id));
}

export function findFirstActiveUserProfile(database) {
  return mapUserProfile(database.prepare(
    "SELECT * FROM user_profiles WHERE deletedAt IS NULL ORDER BY createdAt ASC, id ASC LIMIT 1",
  ).get());
}

export function insertUserProfile(database, profile) {
  database.prepare(`
    INSERT INTO user_profiles (
      id, displayName, avatarMediaId, createdAt, updatedAt, deletedAt,
      version, originDeviceId, lastModifiedByDeviceId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    profile.id,
    profile.displayName,
    profile.avatarMediaId,
    profile.createdAt,
    profile.updatedAt,
    profile.deletedAt,
    profile.version,
    profile.originDeviceId,
    profile.lastModifiedByDeviceId,
  );
  return findUserProfileById(database, profile.id);
}
