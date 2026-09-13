function mapMedia(row) {
  if (!row) return null;
  return { ...row, favorite: Boolean(row.favorite) };
}

export function findMediaById(database, id) {
  return mapMedia(database.prepare("SELECT * FROM media_assets WHERE id = ?").get(id));
}

export function listMediaByUserId(database, userId, filters = {}) {
  const conditions = ["userId = @userId", "deletedAt IS NULL"];
  const parameters = { userId };
  for (const field of ["tradeId", "journalEntryId", "folderId", "source", "availabilityStatus", "checksumSha256"]) {
    if (filters[field]) {
      conditions.push(`${field} = @${field}`);
      parameters[field] = filters[field];
    }
  }
  if (filters.favorite !== undefined) {
    conditions.push("favorite = @favorite");
    parameters.favorite = filters.favorite ? 1 : 0;
  }
  return database.prepare(`
    SELECT * FROM media_assets
    WHERE ${conditions.join(" AND ")}
    ORDER BY uploadedAt DESC, id DESC
  `).all(parameters).map(mapMedia);
}

export function insertMedia(database, media) {
  database.prepare(`
    INSERT INTO media_assets (
      id, userId, tradeId, journalEntryId, folderId, originalFilename,
      mimeType, byteSize, width, height, capturedAt, uploadedAt, storageKey,
      thumbnailKey, checksumSha256, source, favorite, availabilityStatus,
      createdAt, updatedAt, deletedAt, version, originDeviceId,
      lastModifiedByDeviceId
    ) VALUES (
      @id, @userId, @tradeId, @journalEntryId, @folderId, @originalFilename,
      @mimeType, @byteSize, @width, @height, @capturedAt, @uploadedAt,
      @storageKey, @thumbnailKey, @checksumSha256, @source, @favorite,
      @availabilityStatus, @createdAt, @updatedAt, @deletedAt, @version,
      @originDeviceId, @lastModifiedByDeviceId
    )
  `).run({ ...media, favorite: media.favorite ? 1 : 0 });
  return findMediaById(database, media.id);
}

export function updateMediaByVersion(database, media, expectedVersion) {
  const result = database.prepare(`
    UPDATE media_assets SET
      tradeId = @tradeId, journalEntryId = @journalEntryId, folderId = @folderId,
      originalFilename = @originalFilename, mimeType = @mimeType,
      byteSize = @byteSize, width = @width, height = @height,
      capturedAt = @capturedAt, storageKey = @storageKey, thumbnailKey = @thumbnailKey,
      checksumSha256 = @checksumSha256, source = @source, favorite = @favorite,
      availabilityStatus = @availabilityStatus, updatedAt = @updatedAt,
      version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId
    WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL
  `).run({ ...media, favorite: media.favorite ? 1 : 0, expectedVersion });
  return result.changes === 1 ? findMediaById(database, media.id) : null;
}

export function softDeleteMediaByVersion(database, { id, userId, deletedAt, updatedAt, deviceId }, expectedVersion) {
  const result = database.prepare(`
    UPDATE media_assets SET
      deletedAt = ?, updatedAt = ?, version = version + 1,
      lastModifiedByDeviceId = ?
    WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL
  `).run(deletedAt, updatedAt, deviceId, id, userId, expectedVersion);
  return result.changes === 1 ? findMediaById(database, id) : null;
}

export function detachMediaFromFolder(database, folderId, updatedAt, deviceId) {
  database.prepare(`
    UPDATE media_assets SET
      folderId = NULL, updatedAt = ?, version = version + 1,
      lastModifiedByDeviceId = ?
    WHERE folderId = ? AND deletedAt IS NULL
  `).run(updatedAt, deviceId, folderId);
}
