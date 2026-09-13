import { jsonValue, parseJsonColumn } from "../utils.js";

function mapJournalEntry(row) {
  if (!row) return null;
  const { wentWellJson, improvementsJson, ...entry } = row;
  return {
    ...entry,
    wentWell: parseJsonColumn(wentWellJson, "wentWell"),
    improvements: parseJsonColumn(improvementsJson, "improvements"),
  };
}

function databaseValues(entry) {
  return {
    ...entry,
    wentWellJson: jsonValue(entry.wentWell, "wentWell"),
    improvementsJson: jsonValue(entry.improvements, "improvements"),
  };
}

export function findJournalEntryById(database, id) {
  return mapJournalEntry(database.prepare("SELECT * FROM journal_entries WHERE id = ?").get(id));
}

export function listJournalEntriesByUserId(database, userId) {
  return database.prepare(`
    SELECT * FROM journal_entries
    WHERE userId = ? AND deletedAt IS NULL
    ORDER BY createdAt DESC, id DESC
  `).all(userId).map(mapJournalEntry);
}

export function insertJournalEntry(database, entry) {
  const values = databaseValues(entry);
  database.prepare(`
    INSERT INTO journal_entries (
      id, userId, tradeId, analysisSessionId, title, body, mood,
      wentWellJson, improvementsJson, takeaway, createdAt, updatedAt, deletedAt,
      version, originDeviceId, lastModifiedByDeviceId
    ) VALUES (
      @id, @userId, @tradeId, @analysisSessionId, @title, @body, @mood,
      @wentWellJson, @improvementsJson, @takeaway, @createdAt, @updatedAt,
      @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId
    )
  `).run(values);
  return findJournalEntryById(database, entry.id);
}

export function updateJournalEntryByVersion(database, entry, expectedVersion) {
  const values = databaseValues(entry);
  const result = database.prepare(`
    UPDATE journal_entries SET
      tradeId = @tradeId, analysisSessionId = @analysisSessionId,
      title = @title, body = @body, mood = @mood,
      wentWellJson = @wentWellJson, improvementsJson = @improvementsJson,
      takeaway = @takeaway, updatedAt = @updatedAt, version = version + 1,
      lastModifiedByDeviceId = @lastModifiedByDeviceId
    WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL
  `).run({ ...values, expectedVersion });
  return result.changes === 1 ? findJournalEntryById(database, entry.id) : null;
}

export function softDeleteJournalEntryByVersion(database, { id, userId, deletedAt, updatedAt, deviceId }, expectedVersion) {
  const result = database.prepare(`
    UPDATE journal_entries SET
      deletedAt = ?, updatedAt = ?, version = version + 1,
      lastModifiedByDeviceId = ?
    WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL
  `).run(deletedAt, updatedAt, deviceId, id, userId, expectedVersion);
  return result.changes === 1 ? findJournalEntryById(database, id) : null;
}
