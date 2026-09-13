import path from "node:path";
import { findTradeById } from "../repositories/tradeRepository.js";
import { findJournalEntryById } from "../repositories/journalRepository.js";
import { findMediaById, insertMedia, listMediaByUserId, softDeleteMediaByVersion, updateMediaByVersion } from "../repositories/mediaRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, booleanValue, createId, enumValue, integerValue, nowUtc, optionalText, parsePositiveVersion, requiredText, timestampValue, withTransaction } from "../utils.js";

const AVAILABILITY_STATUSES = new Set(["AVAILABLE", "PENDING", "MISSING"]);

export function createMediaService({ database, getContext, classificationService }) {
  const context = () => getContext();

  function ownMedia(id) {
    const media = findMediaById(database, id);
    if (!media || media.userId !== context().userId || media.deletedAt) throw notFound("Media not found.");
    return media;
  }

  function validateStorageKey(value, field = "storageKey") {
    const key = requiredText(value, field, { maxLength: 1000 });
    if (key.includes("\0") || path.posix.isAbsolute(key) || path.win32.isAbsolute(key) || /^[\\/]/.test(key) || /^[A-Za-z]:[\\/]/.test(key) || key.split(/[\\/]+/).includes("..")) {
      throw badRequest(`${field} must be a relative portable storage key.`);
    }
    return key.replaceAll("\\", "/");
  }

  function normalizeFields(source, current = null, { create = false } = {}) {
    const value = current ? { ...current, ...source } : source;
    const local = context();
    const fields = {
      tradeId: value.tradeId === undefined || value.tradeId === null || value.tradeId === "" ? null : requiredText(value.tradeId, "tradeId"),
      journalEntryId: value.journalEntryId === undefined || value.journalEntryId === null || value.journalEntryId === "" ? null : requiredText(value.journalEntryId, "journalEntryId"),
      folderId: value.folderId === undefined || value.folderId === null || value.folderId === "" ? null : requiredText(value.folderId, "folderId"),
      originalFilename: requiredText(value.originalFilename, "originalFilename", { maxLength: 500 }),
      mimeType: requiredText(value.mimeType, "mimeType", { maxLength: 200 }),
      byteSize: integerValue(value.byteSize, "byteSize", { nullable: false, min: 0 }),
      width: integerValue(value.width, "width", { min: 0 }),
      height: integerValue(value.height, "height", { min: 0 }),
      capturedAt: timestampValue(value.capturedAt, "capturedAt"),
      storageKey: validateStorageKey(value.storageKey),
      thumbnailKey: value.thumbnailKey === undefined || value.thumbnailKey === null || value.thumbnailKey === "" ? null : validateStorageKey(value.thumbnailKey, "thumbnailKey"),
      checksumSha256: requiredText(value.checksumSha256, "checksumSha256", { maxLength: 255 }),
      source: requiredText(value.source, "source", { maxLength: 100 }),
      favorite: booleanValue(value.favorite, "favorite", { defaultValue: create ? false : undefined }),
      availabilityStatus: enumValue(value.availabilityStatus, "availabilityStatus", AVAILABILITY_STATUSES, { defaultValue: create ? "AVAILABLE" : undefined }),
    };
    if (fields.tradeId) {
      const trade = findTradeById(database, fields.tradeId);
      if (!trade || trade.userId !== local.userId || trade.deletedAt) throw notFound("Trade relationship was not found.");
    }
    if (fields.journalEntryId) {
      const entry = findJournalEntryById(database, fields.journalEntryId);
      if (!entry || entry.userId !== local.userId || entry.deletedAt) throw notFound("Journal entry relationship was not found.");
    }
    if (fields.folderId) classificationService.getFolder(fields.folderId);
    return fields;
  }

  function create(body) {
    const source = assertRequestObject(body);
    const timestamp = nowUtc();
    const fields = normalizeFields(source, null, { create: true });
    const uploadedAt = source.uploadedAt === undefined || source.uploadedAt === null || source.uploadedAt === ""
      ? timestamp
      : timestampValue(source.uploadedAt, "uploadedAt", { nullable: false });
    const local = context();
    return insertMedia(database, {
      id: createId(), userId: local.userId, ...fields, uploadedAt, createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: local.deviceId, lastModifiedByDeviceId: local.deviceId,
    });
  }

  function list(filters = {}) {
    if (filters && typeof filters === "object" && !Array.isArray(filters)) {
      const normalized = { ...filters };
      if (normalized.favorite !== undefined) normalized.favorite = normalized.favorite === true || normalized.favorite === "true" || normalized.favorite === "1";
      if (normalized.availabilityStatus) normalized.availabilityStatus = enumValue(normalized.availabilityStatus, "availabilityStatus", AVAILABILITY_STATUSES);
      return listMediaByUserId(database, context().userId, normalized);
    }
    throw badRequest("Media filters must be an object.");
  }

  function get(id) { return ownMedia(id); }

  function update(id, body, expectedVersion) {
    const source = assertRequestObject(body);
    const current = ownMedia(id);
    const fields = normalizeFields(source, current);
    const updated = updateMediaByVersion(database, { ...current, ...fields, updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The media metadata was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function remove(id, expectedVersion) {
    const current = ownMedia(id);
    const timestamp = nowUtc();
    const deleted = softDeleteMediaByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The media metadata was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  return { create, list, get, update, remove };
}
