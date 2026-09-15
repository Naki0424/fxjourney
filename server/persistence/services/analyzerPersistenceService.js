import { createHash } from "node:crypto";
import { findTradeById } from "../repositories/tradeRepository.js";
import { findMediaById } from "../repositories/mediaRepository.js";
import { inspectImageBuffer } from "../mediaStorage.js";
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
    return listSessionMedia(database, sessionId).map((item) => ({ ...item, media: mediaService.getReference(item.mediaId) }));
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
    const source = assertRequestObject(body);
    const result = jsonDocument(source.result ?? source.resultJson, "result");
    const timeframesUsed = jsonDocument(source.timeframesUsed ?? source.timeframesUsedJson, "timeframesUsed");
    const analyzedAt = source.analyzedAt ? timestampValue(source.analyzedAt, "analyzedAt", { nullable: false }) : nowUtc();
    const createdAt = nowUtc();
    const serializedResult = jsonValue(result, "result", { nullable: false });
    const contentHash = createHash("sha256").update(serializedResult).digest("hex");
    const requestedPreviousId = source.previousReportId ? requiredText(source.previousReportId, "previousReportId") : null;
    const modelId = requiredText(source.modelId, "modelId", { maxLength: 200 });
    const analysisSchemaVersion = requiredText(source.analysisSchemaVersion, "analysisSchemaVersion", { maxLength: 100 });
    const inserted = withTransaction(database, () => {
      ownSession(sessionId);
      const reports = listReportsBySessionId(database, sessionId);
      const previousReport = reports.at(-1) || null;
      if (requestedPreviousId) {
        const requestedPrevious = ownReport(requestedPreviousId);
        if (requestedPrevious.sessionId !== sessionId) throw badRequest("previousReportId must belong to the same analysis session.");
        if (requestedPreviousId !== previousReport?.id) throw conflict("The report history changed before this report was appended.", "STALE_REPORT_SEQUENCE");
      }
      return insertReport(database, {
        id: createId(), sessionId, previousReportId: previousReport?.id || null,
        modelId, analysisSchemaVersion, timeframesUsed, result, contentHash, analyzedAt, createdAt,
        originDeviceId: context().deviceId,
      });
    });
    const reports = listReportsBySessionId(database, sessionId);
    return { ...inserted, versionNumber: reports.findIndex((item) => item.id === inserted.id) + 1 };
  }

  function listReports(sessionId) { ownSession(sessionId); return listReportsBySessionId(database, sessionId); }
  function getReport(id) {
    const report = ownReport(id);
    const reports = listReportsBySessionId(database, report.sessionId);
    return { ...report, versionNumber: reports.findIndex((item) => item.id === id) + 1 };
  }
  function latestReport(sessionId) {
    const reports = listReports(sessionId);
    return reports.at(-1) || null;
  }

  function getReportForSession(sessionId, versionOrId) {
    ownSession(sessionId);
    const reports = listReportsBySessionId(database, sessionId);
    const report = /^\d+$/.test(String(versionOrId))
      ? reports[Number(versionOrId) - 1]
      : reports.find((item) => item.id === versionOrId);
    if (!report) throw notFound("Analysis report not found.");
    return report;
  }

  function getSessionState(sessionId) {
    const session = ownSession(sessionId);
    return {
      session,
      screenshots: listSessionMediaForSession(sessionId),
      reports: listReportsBySessionId(database, sessionId),
    };
  }

  function persistSuccessfulAnalysis({ sessionId = null, sessionFields = {}, screenshotEntries = [], report }) {
    if (!Array.isArray(screenshotEntries) || screenshotEntries.length === 0) throw badRequest("At least one analysis screenshot is required.");
    const sourceReport = assertRequestObject(report);
    const result = jsonDocument(sourceReport.result, "result");
    const timeframesUsed = jsonDocument(sourceReport.timeframesUsed, "timeframesUsed");
    if (!Array.isArray(timeframesUsed) || timeframesUsed.some((timeframe) => typeof timeframe !== "string" || !timeframe.trim())) {
      throw badRequest("timeframesUsed must be an array of timeframe strings.");
    }
    if (new Set(timeframesUsed).size !== timeframesUsed.length) throw badRequest("timeframesUsed cannot contain duplicates.");
    const analyzedAt = timestampValue(sourceReport.analyzedAt, "analyzedAt", { nullable: false });
    const modelId = requiredText(sourceReport.modelId, "modelId", { maxLength: 200 });
    const analysisSchemaVersion = requiredText(sourceReport.analysisSchemaVersion, "analysisSchemaVersion", { maxLength: 100 });
    const serializedResult = jsonValue(result, "result", { nullable: false });
    const contentHash = createHash("sha256").update(serializedResult).digest("hex");
    let session = sessionId ? ownSession(sessionId) : null;
    if (session?.status === "ARCHIVED") throw badRequest("Archived analysis sessions cannot receive new reports.");
    const createdSession = !session;
    const createdMediaIds = [];
    let committed = false;

    try {
      if (!session) {
        session = createSession(sessionFields);
      }

      const persistedEntries = [];
      const existingMemberships = listSessionMedia(database, session.id);
      const existingByMediaId = new Map(existingMemberships.map((item) => [item.mediaId, item]));
      for (const [index, entry] of screenshotEntries.entries()) {
        const timeframe = requiredText(entry?.timeframe, "timeframe", { maxLength: 50 });
        const existing = entry?.id ? existingByMediaId.get(entry.id) : null;
        if (existing) {
          if (existing.timeframe !== timeframe) throw badRequest("An existing analysis screenshot cannot change timeframe.");
          const existingScreenshot = mediaService.getReference(existing.mediaId);
          if (existingScreenshot.unavailable) throw notFound("The persisted analysis screenshot is unavailable.");
          const inspected = inspectImageBuffer(entry?.file?.buffer, {
            mimeType: entry?.file?.mimetype,
            originalFilename: entry?.file?.originalname,
          });
          if (inspected.checksumSha256 !== existingScreenshot.checksumSha256) throw badRequest("The analysis screenshot content does not match the persisted media asset.");
          persistedEntries.push({ mediaId: existing.mediaId, timeframe, ordinal: existing.ordinal, isPrimary: existing.isPrimary });
          continue;
        }
        const media = mediaService.createUploadedScreenshot({ file: entry?.file, metadata: {} });
        createdMediaIds.push(media.id);
        persistedEntries.push({ mediaId: media.id, timeframe, ordinal: index + 1, isPrimary: index === 0 });
      }

      const committedState = withTransaction(database, () => {
        const currentSession = ownSession(session.id);
        const reports = listReportsBySessionId(database, session.id);
        const previousReport = reports.at(-1) || null;
        const currentMemberships = listSessionMedia(database, session.id);
        const currentByMediaId = new Map(currentMemberships.map((item) => [item.mediaId, item]));

        for (const item of persistedEntries) {
          const current = currentByMediaId.get(item.mediaId);
          if (current) {
            if (current.timeframe !== item.timeframe) throw badRequest("An existing analysis screenshot cannot change timeframe.");
            continue;
          }
          if (findActiveSessionMediaByOrdinal(database, session.id, item.ordinal)) {
            throw conflict("The analysis session ordinal is already in use.", "DUPLICATE_ORDINAL");
          }
          const timestamp = nowUtc();
          insertSessionMedia(database, {
            id: createId(), sessionId: session.id, mediaId: item.mediaId, timeframe: item.timeframe,
            ordinal: item.ordinal, isPrimary: item.isPrimary, addedAt: timestamp, createdAt: timestamp,
            updatedAt: timestamp, deletedAt: null, version: 1, originDeviceId: context().deviceId,
            lastModifiedByDeviceId: context().deviceId,
          });
        }

        const insertedReport = insertReport(database, {
          id: createId(), sessionId: session.id, previousReportId: previousReport?.id || null,
          modelId, analysisSchemaVersion, timeframesUsed, result, contentHash, analyzedAt,
          createdAt: nowUtc(), originDeviceId: context().deviceId,
        });
        return { currentSession, insertedReport };
      });
      committed = true;
      const reports = listReportsBySessionId(database, session.id);
      return {
        session: findSessionById(database, session.id),
        screenshots: listSessionMediaForSession(session.id),
        report: reports.find((item) => item.id === committedState.insertedReport.id),
      };
    } catch (error) {
      if (!committed) {
        createdMediaIds.forEach((mediaId) => mediaService.discardUploadedScreenshot(mediaId));
        if (createdSession && session) {
          try {
            const current = findSessionById(database, session.id);
            if (current && !current.deletedAt) {
              const timestamp = nowUtc();
              softDeleteSessionByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, current.version);
            }
          } catch {
            // The original request still fails; retain a tombstone if cleanup cannot complete.
          }
        }
      }
      throw error;
    }
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
    getSessionState, persistSuccessfulAnalysis,
    appendReport, listReports, getReport, getReportForSession, latestReport,
    feedbackForReport, createFeedback, updateFeedback, removeFeedback,
  };
}
