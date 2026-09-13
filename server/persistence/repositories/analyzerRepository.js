import { jsonValue, parseJsonColumn } from "../utils.js";

function mapSession(row) {
  if (!row) return null;
  const { contextJson, ...session } = row;
  return { ...session, context: parseJsonColumn(contextJson, "context") };
}

function mapSessionMedia(row) {
  if (!row) return null;
  return { ...row, isPrimary: Boolean(row.isPrimary) };
}

function mapReport(row) {
  if (!row) return null;
  const { timeframesUsedJson, resultJson, ...report } = row;
  return {
    ...report,
    timeframesUsed: parseJsonColumn(timeframesUsedJson, "timeframesUsed"),
    result: parseJsonColumn(resultJson, "result"),
  };
}

function mapFeedback(row) {
  return row ? { ...row } : null;
}

export function findSessionById(database, id) { return mapSession(database.prepare("SELECT * FROM analysis_sessions WHERE id = ?").get(id)); }
export function listSessionsByUserId(database, userId) { return database.prepare("SELECT * FROM analysis_sessions WHERE userId = ? AND deletedAt IS NULL ORDER BY createdAt DESC, id DESC").all(userId).map(mapSession); }
export function insertSession(database, session) {
  database.prepare(`INSERT INTO analysis_sessions (id, userId, linkedTradeId, instrument, primaryTimeframe, status, contextJson, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @userId, @linkedTradeId, @instrument, @primaryTimeframe, @status, @contextJson, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run({ ...session, contextJson: jsonValue(session.context, "context") });
  return findSessionById(database, session.id);
}
export function updateSessionByVersion(database, session, expectedVersion) {
  const result = database.prepare(`UPDATE analysis_sessions SET linkedTradeId = @linkedTradeId, instrument = @instrument, primaryTimeframe = @primaryTimeframe, status = @status, contextJson = @contextJson, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...session, contextJson: jsonValue(session.context, "context"), expectedVersion });
  return result.changes === 1 ? findSessionById(database, session.id) : null;
}
export function softDeleteSessionByVersion(database, session, expectedVersion) {
  const result = database.prepare("UPDATE analysis_sessions SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL").run(session.deletedAt, session.updatedAt, session.deviceId, session.id, session.userId, expectedVersion);
  return result.changes === 1 ? findSessionById(database, session.id) : null;
}

export function findSessionMediaById(database, id) { return mapSessionMedia(database.prepare("SELECT * FROM analysis_session_media WHERE id = ?").get(id)); }
export function findActiveSessionMedia(database, sessionId, mediaId) { return mapSessionMedia(database.prepare("SELECT * FROM analysis_session_media WHERE sessionId = ? AND mediaId = ? AND deletedAt IS NULL").get(sessionId, mediaId)); }
export function findActiveSessionMediaByOrdinal(database, sessionId, ordinal) { return mapSessionMedia(database.prepare("SELECT * FROM analysis_session_media WHERE sessionId = ? AND ordinal = ? AND deletedAt IS NULL").get(sessionId, ordinal)); }
export function listSessionMedia(database, sessionId) { return database.prepare("SELECT * FROM analysis_session_media WHERE sessionId = ? AND deletedAt IS NULL ORDER BY ordinal ASC, id ASC").all(sessionId).map(mapSessionMedia); }
export function insertSessionMedia(database, media) {
  database.prepare(`INSERT INTO analysis_session_media (id, sessionId, mediaId, timeframe, ordinal, isPrimary, addedAt, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @sessionId, @mediaId, @timeframe, @ordinal, @isPrimary, @addedAt, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run({ ...media, isPrimary: media.isPrimary ? 1 : 0 });
  return findSessionMediaById(database, media.id);
}
export function softDeleteSessionMediaByVersion(database, media, expectedVersion) {
  const result = database.prepare("UPDATE analysis_session_media SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND version = ? AND deletedAt IS NULL").run(media.deletedAt, media.updatedAt, media.deviceId, media.id, expectedVersion);
  return result.changes === 1 ? findSessionMediaById(database, media.id) : null;
}
export function softDeleteSessionMediaForSession(database, sessionId, updatedAt, deviceId) {
  database.prepare("UPDATE analysis_session_media SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE sessionId = ? AND deletedAt IS NULL").run(updatedAt, updatedAt, deviceId, sessionId);
}

export function findReportById(database, id) { return mapReport(database.prepare("SELECT * FROM analysis_report_versions WHERE id = ?").get(id)); }
export function listReportsBySessionId(database, sessionId) {
  return database.prepare("SELECT * FROM analysis_report_versions WHERE sessionId = ? ORDER BY analyzedAt ASC, createdAt ASC, id ASC").all(sessionId).map((row, index) => ({ ...mapReport(row), versionNumber: index + 1 }));
}
export function insertReport(database, report) {
  database.prepare(`INSERT INTO analysis_report_versions (id, sessionId, previousReportId, modelId, analysisSchemaVersion, timeframesUsedJson, resultJson, contentHash, analyzedAt, createdAt, originDeviceId) VALUES (@id, @sessionId, @previousReportId, @modelId, @analysisSchemaVersion, @timeframesUsedJson, @resultJson, @contentHash, @analyzedAt, @createdAt, @originDeviceId)`).run({
    ...report,
    timeframesUsedJson: jsonValue(report.timeframesUsed, "timeframesUsed", { nullable: false }),
    resultJson: jsonValue(report.result, "result", { nullable: false }),
  });
  return findReportById(database, report.id);
}

export function findFeedbackById(database, id) { return mapFeedback(database.prepare("SELECT * FROM analysis_report_feedback WHERE id = ?").get(id)); }
export function findActiveFeedbackByReportId(database, reportId) { return mapFeedback(database.prepare("SELECT * FROM analysis_report_feedback WHERE reportId = ? AND deletedAt IS NULL").get(reportId)); }
export function insertFeedback(database, feedback) {
  database.prepare(`INSERT INTO analysis_report_feedback (id, reportId, rating, note, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @reportId, @rating, @note, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run(feedback);
  return findFeedbackById(database, feedback.id);
}
export function updateFeedbackByVersion(database, feedback, expectedVersion) {
  const result = database.prepare(`UPDATE analysis_report_feedback SET rating = @rating, note = @note, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...feedback, expectedVersion });
  return result.changes === 1 ? findFeedbackById(database, feedback.id) : null;
}
export function softDeleteFeedbackByVersion(database, feedback, expectedVersion) {
  const result = database.prepare("UPDATE analysis_report_feedback SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND version = ? AND deletedAt IS NULL").run(feedback.deletedAt, feedback.updatedAt, feedback.deviceId, feedback.id, expectedVersion);
  return result.changes === 1 ? findFeedbackById(database, feedback.id) : null;
}
