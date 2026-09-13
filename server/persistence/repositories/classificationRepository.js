function mapTag(row) {
  return row ? { ...row } : null;
}

function mapCategory(row) {
  return row ? { ...row } : null;
}

function mapFolder(row) {
  return row ? { ...row } : null;
}

function mapRelationship(row) {
  if (!row) return null;
  return { ...row, confirmed: row.confirmed === undefined ? row.confirmed : Boolean(row.confirmed) };
}

export function findTagById(database, id) { return mapTag(database.prepare("SELECT * FROM tags WHERE id = ?").get(id)); }
export function findActiveTagByNormalizedName(database, userId, normalizedName) {
  return mapTag(database.prepare("SELECT * FROM tags WHERE userId = ? AND normalizedName = ? AND deletedAt IS NULL").get(userId, normalizedName));
}
export function listTagsByUserId(database, userId) {
  return database.prepare("SELECT * FROM tags WHERE userId = ? AND deletedAt IS NULL ORDER BY normalizedName ASC, id ASC").all(userId).map(mapTag);
}
export function insertTag(database, tag) {
  database.prepare(`INSERT INTO tags (id, userId, name, normalizedName, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @userId, @name, @normalizedName, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run(tag);
  return findTagById(database, tag.id);
}
export function updateTagByVersion(database, tag, expectedVersion) {
  const result = database.prepare(`UPDATE tags SET name = @name, normalizedName = @normalizedName, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...tag, expectedVersion });
  return result.changes === 1 ? findTagById(database, tag.id) : null;
}
export function softDeleteTagByVersion(database, tag, expectedVersion) {
  const result = database.prepare("UPDATE tags SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL").run(tag.deletedAt, tag.updatedAt, tag.deviceId, tag.id, tag.userId, expectedVersion);
  return result.changes === 1 ? findTagById(database, tag.id) : null;
}

export function findCategoryById(database, id) { return mapCategory(database.prepare("SELECT * FROM categories WHERE id = ?").get(id)); }
export function listCategoriesByUserId(database, userId) {
  return database.prepare("SELECT * FROM categories WHERE (userId = ? OR userId IS NULL) AND deletedAt IS NULL ORDER BY name ASC, id ASC").all(userId).map(mapCategory);
}
export function insertCategory(database, category) {
  database.prepare(`INSERT INTO categories (id, userId, name, normalizedName, groupName, description, source, icon, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @userId, @name, @normalizedName, @groupName, @description, @source, @icon, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run(category);
  return findCategoryById(database, category.id);
}
export function updateCategoryByVersion(database, category, expectedVersion) {
  const result = database.prepare(`UPDATE categories SET name = @name, normalizedName = @normalizedName, groupName = @groupName, description = @description, icon = @icon, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...category, expectedVersion });
  return result.changes === 1 ? findCategoryById(database, category.id) : null;
}
export function softDeleteCategoryByVersion(database, category, expectedVersion) {
  const result = database.prepare("UPDATE categories SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL").run(category.deletedAt, category.updatedAt, category.deviceId, category.id, category.userId, expectedVersion);
  return result.changes === 1 ? findCategoryById(database, category.id) : null;
}

export function findFolderById(database, id) { return mapFolder(database.prepare("SELECT * FROM screenshot_folders WHERE id = ?").get(id)); }
export function listFoldersByUserId(database, userId) {
  return database.prepare("SELECT * FROM screenshot_folders WHERE userId = ? AND deletedAt IS NULL ORDER BY sortOrder IS NULL, sortOrder ASC, name ASC, id ASC").all(userId).map(mapFolder);
}
export function insertFolder(database, folder) {
  database.prepare(`INSERT INTO screenshot_folders (id, userId, name, sortOrder, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @userId, @name, @sortOrder, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run(folder);
  return findFolderById(database, folder.id);
}
export function updateFolderByVersion(database, folder, expectedVersion) {
  const result = database.prepare(`UPDATE screenshot_folders SET name = @name, sortOrder = @sortOrder, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...folder, expectedVersion });
  return result.changes === 1 ? findFolderById(database, folder.id) : null;
}
export function softDeleteFolderByVersion(database, folder, expectedVersion) {
  const result = database.prepare("UPDATE screenshot_folders SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL").run(folder.deletedAt, folder.updatedAt, folder.deviceId, folder.id, folder.userId, expectedVersion);
  return result.changes === 1 ? findFolderById(database, folder.id) : null;
}

export function findActiveRelationship(database, table, parentColumn, parentId, targetColumn, targetId) {
  return mapRelationship(database.prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? AND ${targetColumn} = ? AND deletedAt IS NULL`).get(parentId, targetId));
}
export function findRelationshipById(database, table, id) {
  return mapRelationship(database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
}
export function insertRelationship(database, table, relationship) {
  database.prepare(`INSERT INTO ${table} (id, ${Object.keys(relationship).filter((key) => !["id"].includes(key)).join(", ")}) VALUES (@id, ${Object.keys(relationship).filter((key) => !["id"].includes(key)).map((key) => `@${key}`).join(", ")})`).run(relationship);
  return findRelationshipById(database, table, relationship.id);
}
export function listRelationships(database, table, parentColumn, parentId) {
  return database.prepare(`SELECT * FROM ${table} WHERE ${parentColumn} = ? AND deletedAt IS NULL ORDER BY createdAt ASC, id ASC`).all(parentId).map(mapRelationship);
}
export function softDeleteRelationshipByVersion(database, table, { id, deletedAt, updatedAt, deviceId }, expectedVersion) {
  const result = database.prepare(`UPDATE ${table} SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND version = ? AND deletedAt IS NULL`).run(deletedAt, updatedAt, deviceId, id, expectedVersion);
  return result.changes === 1 ? findRelationshipById(database, table, id) : null;
}
export function softDeleteRelationshipsForParent(database, table, parentColumn, parentId, updatedAt, deviceId) {
  database.prepare(`UPDATE ${table} SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE ${parentColumn} = ? AND deletedAt IS NULL`).run(updatedAt, updatedAt, deviceId, parentId);
}

export function updateMediaCategoryByVersion(database, relationship, expectedVersion) {
  const result = database.prepare(`UPDATE media_categories SET source = @source, confidence = @confidence, confirmed = @confirmed, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND version = @expectedVersion AND deletedAt IS NULL`).run({
    ...relationship,
    confirmed: relationship.confirmed ? 1 : 0,
    expectedVersion,
  });
  return result.changes === 1 ? mapRelationship(database.prepare("SELECT * FROM media_categories WHERE id = ?").get(relationship.id)) : null;
}
