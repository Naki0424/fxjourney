import { findTradeById } from "../repositories/tradeRepository.js";
import { findSessionById } from "../repositories/analyzerRepository.js";
import { findJournalEntryById, insertJournalEntry, listJournalEntriesByUserId, softDeleteJournalEntryByVersion, updateJournalEntryByVersion } from "../repositories/journalRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, createId, enumValue, jsonValue, nowUtc, optionalText, parsePositiveVersion, requiredText, withTransaction } from "../utils.js";

const MOODS = new Set(["POSITIVE", "NEUTRAL", "CHALLENGING"]);

export function createJournalService({ database, getContext, classificationService }) {
  const context = () => getContext();

  function ownEntry(id) {
    const entry = findJournalEntryById(database, id);
    if (!entry || entry.userId !== context().userId || entry.deletedAt) throw notFound("Journal entry not found.");
    return entry;
  }

  function validateTagIds(tagIds) {
    if (tagIds === undefined) return undefined;
    if (!Array.isArray(tagIds)) throw badRequest("tagIds must be an array.");
    const ids = tagIds.map((id) => requiredText(id, "tagId"));
    if (new Set(ids).size !== ids.length) throw badRequest("tagIds must not contain duplicates.");
    ids.forEach((id) => classificationService.getTag(id));
    return ids;
  }

  function validateLinks(source) {
    if (source.tradeId !== undefined && source.tradeId !== null && source.tradeId !== "") {
      const trade = findTradeById(database, source.tradeId);
      if (!trade || trade.userId !== context().userId || trade.deletedAt) throw notFound("Trade not found.");
    }
    if (source.analysisSessionId !== undefined && source.analysisSessionId !== null && source.analysisSessionId !== "") {
      const session = findSessionById(database, source.analysisSessionId);
      if (!session || session.userId !== context().userId || session.deletedAt) throw notFound("Analysis session not found.");
    }
  }

  function normalizedFields(source, current = null) {
    const value = current ? { ...current, ...source } : source;
    const fields = {
      tradeId: value.tradeId || null,
      analysisSessionId: value.analysisSessionId || null,
      title: optionalText(value.title, "title", { maxLength: 300 }),
      body: requiredText(value.body, "body", { maxLength: 50000 }),
      mood: enumValue(value.mood, "mood", MOODS),
      wentWell: value.wentWell === undefined ? null : value.wentWell,
      improvements: value.improvements === undefined ? null : value.improvements,
      takeaway: optionalText(value.takeaway, "takeaway", { maxLength: 10000 }),
    };
    for (const [field, data] of [["wentWell", fields.wentWell], ["improvements", fields.improvements]]) {
      if (data !== null) {
        if (!Array.isArray(data)) throw badRequest(`${field} must be an array when supplied.`);
        jsonValue(data, field);
      }
    }
    validateLinks(fields);
    return fields;
  }

  function withTags(entry, includeTags = true) {
    return includeTags ? { ...entry, tags: classificationService.listJournalTags(entry.id) } : entry;
  }

  function syncTags(entryId, tagIds) {
    if (tagIds === undefined) return;
    const desired = new Set(tagIds);
    const current = classificationService.listJournalTags(entryId);
    for (const relationship of current) {
      if (!desired.has(relationship.tagId)) classificationService.detachJournalTag(entryId, relationship.tagId, relationship.version);
    }
    for (const tagId of desired) {
      if (!current.some((relationship) => relationship.tagId === tagId)) classificationService.attachJournalTag(entryId, tagId);
    }
  }

  function create(body) {
    const source = assertRequestObject(body);
    const tagIds = validateTagIds(source.tagIds) || [];
    const fields = normalizedFields(source);
    const timestamp = nowUtc();
    const local = context();
    return withTransaction(database, () => {
      const entry = insertJournalEntry(database, {
        id: createId(), userId: local.userId, ...fields, createdAt: timestamp, updatedAt: timestamp,
        deletedAt: null, version: 1, originDeviceId: local.deviceId, lastModifiedByDeviceId: local.deviceId,
      });
      tagIds.forEach((tagId) => classificationService.attachJournalTag(entry.id, tagId));
      return withTags(entry);
    });
  }

  function list() {
    return listJournalEntriesByUserId(database, context().userId).map((entry) => withTags(entry));
  }

  function get(id) { return withTags(ownEntry(id)); }

  function update(id, body, expectedVersion) {
    const source = assertRequestObject(body);
    const current = ownEntry(id);
    const fields = normalizedFields(source, current);
    const tagIds = validateTagIds(source.tagIds);
    const timestamp = nowUtc();
    const updated = withTransaction(database, () => {
      const result = updateJournalEntryByVersion(database, { ...current, ...fields, updatedAt: timestamp, lastModifiedByDeviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
      if (!result) throw conflict("The journal entry was changed by another operation.", "STALE_VERSION");
      syncTags(id, tagIds);
      return result;
    });
    return withTags(updated);
  }

  function remove(id, expectedVersion) {
    const current = ownEntry(id);
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      const deleted = softDeleteJournalEntryByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
      if (!deleted) throw conflict("The journal entry was changed by another operation.", "STALE_VERSION");
      classificationService.softDeleteJournalTags(id, timestamp);
      return deleted;
    });
  }

  return { create, list, get, update, remove };
}
