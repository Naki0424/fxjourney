import { createHash } from "node:crypto";
import { findTradeById } from "../repositories/tradeRepository.js";
import { findMediaById } from "../repositories/mediaRepository.js";
import {
  findActiveFeedbackByReportId,
  findActiveSessionMedia,
  findActiveSessionMediaByOrdinal,
  findFeedbackById,
  findReportById,
  findSessionById,
  findSessionMediaById,
  insertFeedback,
  insertReport,
  insertSession,
  insertSessionMedia,
  listReportsBySessionId,
  listSessionMedia,
  listSessionsByUserId,
  softDeleteFeedbackByVersion,
  softDeleteSessionByVersion,
  softDeleteSessionMediaByVersion,
  softDeleteSessionMediaForSession,
  updateFeedbackByVersion,
  updateSessionByVersion,
} from "../repositories/analyzerRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, booleanValue, createId, enumValue, integerValue, jsonValue, nowUtc, optionalText, parsePositiveVersion, requiredText, timestampValue, withTransaction } from "../utils.js";

const SESSION_STATUSES = new Set(["ACTIVE", "COMPLETE", "ARCHIVED"]);
const FEEDBACK_RATINGS = new Set(["HELPFUL", "NOT_HELPFUL"]);

export function createAnalyzerPersistenceService({ database, getContext, mediaService }) {
  const context = () => getContext();

  function ownSession(id) {
    const session = findSessionById(database, id);
    if (!session || session.userId !== context().userId || session.deletedAt) throw notFound("Analysis session not found.");
    return session;
  }

  function ownMedia(id) {
    const media = findMediaById(database, id);
    if (!media || media.userId !== context().userId || media.deletedAt) throw notFound("Media not found.");
    return media;
  }

  function validateLinkedTrade(linkedTradeId) {
    if (!linkedTradeId) return;
    const trade = findTradeById(database, linkedTradeId);
    if (!trade || trade.userId !== context().userId || trade.deletedAt) throw notFound("Linked trade not found.");
  }

  function normalizeSessionFields(source, current = null) {
    const value = current ? { ...current, ...source } : source;
    const fields = {
      linkedTradeId: value.linkedTradeId || null,
      instrument: optionalText(value.instrument, "instrument", { maxLength: 100 }),
      primaryTimeframe: optionalText(value.primaryTimeframe, "primaryTimeframe", { maxLength: 50 }),
      status: enumValue(value.status, "status", SESSION_STATUSES, { defaultValue: current ? undefined : "ACTIVE" }),
      context: value.context === undefined ? null : value.context,
    };
    if (fields.linkedTradeId) validateLinkedTrade(fields.linkedTradeId);
    if (fields.context !== null) jsonValue(fields.context, "context");
    return fields;
  }

  function createSession(body) {
    const source = assertRequestObject(body);
    const fields = normalizeSessionFields(source);
    const timestamp = nowUtc();
    return insertSession(database, {
      id: createId(), userId: context().userId, ...fields, createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function listSessions() { return listSessionsByUserId(database, context().userId); }
  function getSession(id) { return ownSession(id); }

  function updateSession(id, body, expectedVersion) {
    const current = ownSession(id);
    const fields = normalizeSessionFields(assertRequestObject(body), current);
    const updated = updateSessionByVersion(database, { ...current, ...fields, updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The analysis session was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function removeSession(id, expectedVersion) {
    const current = ownSession(id);
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      const deleted = softDeleteSessionByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
      if (!deleted) throw conflict("The analysis session was changed by another operation.", "STALE_VERSION");
      softDeleteSessionMediaForSession(database, id, timestamp, context().deviceId);
      return deleted;
    });
  }

  function attachSessionMedia(sessionId, body) {
    ownSession(sessionId);
    const source = assertRequestObject(body);
    const mediaId = requiredText(source.mediaId, "mediaId");
    ownMedia(mediaId);
    const timeframe = requiredText(source.timeframe, "timeframe", { maxLength: 50 });
    const ordinal = integerValue(source.ordinal, "ordinal", { nullable: false, min: 1 });
    const isPrimary = booleanValue(source.isPrimary, "isPrimary", { defaultValue: false });
    return withTransaction(database, () => {
      if (findActiveSessionMedia(database, sessionId, mediaId)) throw conflict("This media is already attached to the analysis session.", "DUPLICATE_RELATIONSHIP");
      if (findActiveSessionMediaByOrdinal(database, sessionId, ordinal)) throw conflict("The analysis session ordinal is already in use.", "DUPLICATE_ORDINAL");
      const timestamp = nowUtc();
      return insertSessionMedia(database, {
        id: createId(), sessionId, mediaId, timeframe, ordinal, isPrimary, addedAt: source.addedAt ? timestampValue(source.addedAt, "addedAt", { nullable: false }) : timestamp,
        createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1,
        originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
      });
    });
  }

  function listSessionMediaForSession(sessionId) {
    ownSession(sessionId);
    return listSessionMedia(database, sessionId).map((item) => ({ ...item, media: mediaService.get(item.mediaId) }));
  }

  function detachSessionMedia(sessionId, mediaId, expectedVersion) {
    ownSession(sessionId);
    const current = findActiveSessionMedia(database, sessionId, mediaId);
    if (!current) throw notFound("Session media relationship not found.");
    const timestamp = nowUtc();
    const deleted = softDeleteSessionMediaByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The session media relationship was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  function ownReport(id) {
    const report = findReportById(database, id);
    if (!report) throw notFound("Analysis report not found.");
    const session = findSessionById(database, report.sessionId);
    if (!session || session.userId !== context().userId || session.deletedAt) throw notFound("Analysis report not found.");
    return report;
  }

  function jsonDocument(value, field, { required = true } = {}) {
    if (value === undefined || value === null) {
      if (!required) return null;
      throw badRequest(`${field} is required.`);
    }
    let document = value;
    if (typeof value === "string") {
      try {
        document = JSON.parse(value);
      } catch {
        throw badRequest(`${field} must contain valid JSON.`);
      }
    }
    jsonValue(document, field, { nullable: false });
    return document;
  }

  function appendReport(sessionId, body) {
    ownSession(sessionId);
    const source = assertRequestObject(body);
    const result = jsonDocument(source.result ?? source.resultJson, "result");
    const timeframesUsed = jsonDocument(source.timeframesUsed ?? source.timeframesUsedJson, "timeframesUsed");
    const analyzedAt = source.analyzedAt ? timestampValue(source.analyzedAt, "analyzedAt", { nullable: false }) : nowUtc();
    const createdAt = nowUtc();
    const serializedResult = jsonValue(result, "result", { nullable: false });
    const contentHash = source.contentHash
      ? requiredText(source.contentHash, "contentHash", { maxLength: 255 })
      : createHash("sha256").update(serializedResult).digest("hex");
    if (source.previousReportId) {
      const previous = ownReport(source.previousReportId);
      if (previous.sessionId !== sessionId) throw badRequest("previousReportId must belong to the same analysis session.");
    }
    return insertReport(database, {
      id: createId(), sessionId, previousReportId: source.previousReportId || null,
      modelId: requiredText(source.modelId, "modelId", { maxLength: 200 }),
      analysisSchemaVersion: requiredText(source.analysisSchemaVersion, "analysisSchemaVersion", { maxLength: 100 }),
      timeframesUsed, result, contentHash, analyzedAt, createdAt, originDeviceId: context().deviceId,
    });
  }

  function listReports(sessionId) { ownSession(sessionId); return listReportsBySessionId(database, sessionId); }
  function getReport(id) { return ownReport(id); }
  function latestReport(sessionId) {
    const reports = listReports(sessionId);
    return reports.at(-1) || null;
  }

  function ownFeedback(id) {
    const feedback = findFeedbackById(database, id);
    if (!feedback || feedback.deletedAt) throw notFound("Report feedback not found.");
    ownReport(feedback.reportId);
    return feedback;
  }

  function feedbackForReport(reportId) {
    ownReport(reportId);
    return findActiveFeedbackByReportId(database, reportId);
  }

  function createFeedback(reportId, body) {
    ownReport(reportId);
    const source = assertRequestObject(body);
    if (findActiveFeedbackByReportId(database, reportId)) throw conflict("This report already has active feedback.", "DUPLICATE_FEEDBACK");
    const timestamp = nowUtc();
    return insertFeedback(database, {
      id: createId(), reportId, rating: enumValue(source.rating, "rating", FEEDBACK_RATINGS), note: optionalText(source.note, "note", { maxLength: 5000 }),
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1,
      originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function updateFeedback(id, body, expectedVersion) {
    const current = ownFeedback(id);
    const source = assertRequestObject(body);
    const updated = updateFeedbackByVersion(database, {
      ...current,
      rating: source.rating === undefined ? current.rating : enumValue(source.rating, "rating", FEEDBACK_RATINGS),
      note: source.note === undefined ? current.note : optionalText(source.note, "note", { maxLength: 5000 }),
      updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId,
    }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The report feedback was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function removeFeedback(id, expectedVersion) {
    const current = ownFeedback(id);
    const timestamp = nowUtc();
    const deleted = softDeleteFeedbackByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The report feedback was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  return {
    createSession, listSessions, getSession, updateSession, removeSession,
    attachSessionMedia, listSessionMedia: listSessionMediaForSession, detachSessionMedia,
    appendReport, listReports, getReport, latestReport,
    feedbackForReport, createFeedback, updateFeedback, removeFeedback,
  };
}
