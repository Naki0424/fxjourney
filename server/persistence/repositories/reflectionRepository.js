function mapReflection(row) { return row ? { ...row } : null; }

export function findReflectionById(database, id) { return mapReflection(database.prepare("SELECT * FROM weekly_reflections WHERE id = ?").get(id)); }
export function findActiveReflectionByWeek(database, userId, weekStart) { return mapReflection(database.prepare("SELECT * FROM weekly_reflections WHERE userId = ? AND weekStart = ? AND deletedAt IS NULL").get(userId, weekStart)); }
export function listReflectionsByUserId(database, userId) { return database.prepare("SELECT * FROM weekly_reflections WHERE userId = ? AND deletedAt IS NULL ORDER BY weekStart DESC, id DESC").all(userId).map(mapReflection); }
export function insertReflection(database, reflection) {
  database.prepare(`INSERT INTO weekly_reflections (id, userId, weekStart, body, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @userId, @weekStart, @body, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run(reflection);
  return findReflectionById(database, reflection.id);
}
export function updateReflectionByVersion(database, reflection, expectedVersion) {
  const result = database.prepare(`UPDATE weekly_reflections SET weekStart = @weekStart, body = @body, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...reflection, expectedVersion });
  return result.changes === 1 ? findReflectionById(database, reflection.id) : null;
}
export function softDeleteReflectionByVersion(database, reflection, expectedVersion) {
  const result = database.prepare("UPDATE weekly_reflections SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL").run(reflection.deletedAt, reflection.updatedAt, reflection.deviceId, reflection.id, reflection.userId, expectedVersion);
  return result.changes === 1 ? findReflectionById(database, reflection.id) : null;
}
