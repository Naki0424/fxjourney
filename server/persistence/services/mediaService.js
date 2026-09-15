import path from "node:path";
import { findTradeById } from "../repositories/tradeRepository.js";
import { findJournalEntryById } from "../repositories/journalRepository.js";
import { findMediaById, insertMedia, listMediaByUserId, softDeleteMediaByVersion, updateMediaByVersion } from "../repositories/mediaRepository.js";
import { inspectImageBuffer } from "../mediaStorage.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, booleanValue, createId, enumValue, integerValue, nowUtc, optionalText, parsePositiveVersion, requiredText, timestampValue, withTransaction } from "../utils.js";

const AVAILABILITY_STATUSES = new Set(["AVAILABLE", "PENDING", "MISSING"]);
// Schema v1 uses source to distinguish upload origin; UPLOAD is the existing convention for library images.
const SCREENSHOT_SOURCE = "UPLOAD";

function listValues(value, field) {
  if (value === undefined || value === null || value === "") return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array.`);
  return [...new Set(value.map((item) => requiredText(item, field)))];
}

export function createMediaService({ database, getContext, classificationService, mediaStorage }) {
  const context = () => getContext();

  function ownMedia(id) {
    const media = findMediaById(database, id);
    if (!media || media.userId !== context().userId || media.deletedAt) throw notFound("Media not found.");
    return media;
  }

  function ownScreenshot(id) {
    const media = ownMedia(id);
    if (media.source !== SCREENSHOT_SOURCE) throw notFound("Screenshot not found.");
    return media;
  }

  function screenshotView(media) {
    const tags = classificationService.listMediaTags(media.id).map((relationship) => relationship.tag).filter(Boolean);
    const categories = classificationService.listMediaCategories(media.id).map((relationship) => ({
      ...relationship,
      ...(relationship.category || {}),
    })).filter((category) => category.id);
    return {
      ...media,
      linkedToTrade: Boolean(media.tradeId),
      tags,
      categories,
    };
  }

  function listScreenshots(filters = {}) {
    return list({ ...filters, source: SCREENSHOT_SOURCE }).map(screenshotView);
  }

  function getScreenshot(id) {
    return screenshotView(ownScreenshot(id));
  }

  function getReference(id) {
    const media = findMediaById(database, id);
    if (!media || media.userId !== context().userId) throw notFound("Media not found.");
    if (media.deletedAt) {
      return { ...media, linkedToTrade: Boolean(media.tradeId), unavailable: true, tags: [], categories: [] };
    }
    return {
      ...screenshotView(media),
      unavailable: mediaStorage ? !mediaStorage.exists(media.storageKey) : false,
    };
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

  function createUploadedScreenshot({ file, metadata = {} }) {
    if (!mediaStorage) throw badRequest("Media storage is not configured.");
    const source = assertRequestObject(metadata);
    const buffer = file?.buffer;
    const inspected = inspectImageBuffer(buffer, {
      mimeType: file?.mimetype,
      originalFilename: file?.originalname,
    });
    const timestamp = nowUtc();
    const id = createId();
    const storageKey = `screenshots/${timestamp.slice(0, 4)}/${timestamp.slice(5, 7)}/${id}.${inspected.extension}`;
    const tagIds = listValues(source.tagIds, "tagIds");
    const categoryIds = listValues(source.categoryIds, "categoryIds");
    const tagNames = listValues(source.tagNames, "tagNames");

    tagIds.forEach((tagId) => classificationService.getTag(tagId));
    categoryIds.forEach((categoryId) => classificationService.getCategory(categoryId));
    const fields = normalizeFields({
      ...source,
      originalFilename: inspected.originalFilename,
      mimeType: inspected.mimeType,
      byteSize: buffer.length,
      width: inspected.width,
      height: inspected.height,
      storageKey,
      thumbnailKey: null,
      checksumSha256: inspected.checksumSha256,
      source: SCREENSHOT_SOURCE,
      availabilityStatus: "AVAILABLE",
    }, null, { create: true });

    let stored = false;
    try {
      mediaStorage.store({ buffer, storageKey });
      stored = true;
      return withTransaction(database, () => {
        const media = insertMedia(database, {
          id,
          userId: context().userId,
          ...fields,
          uploadedAt: timestamp,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          version: 1,
          originDeviceId: context().deviceId,
          lastModifiedByDeviceId: context().deviceId,
        });
        const attachedTagIds = new Set();
        tagIds.forEach((tagId) => {
          classificationService.attachMediaTag(id, tagId);
          attachedTagIds.add(tagId);
        });
        tagNames.forEach((tagName) => {
          const tag = classificationService.ensureTag(tagName);
          if (!attachedTagIds.has(tag.id)) {
            classificationService.attachMediaTag(id, tag.id);
            attachedTagIds.add(tag.id);
          }
        });
        categoryIds.forEach((categoryId) => classificationService.attachMediaCategory(id, {
          categoryId,
          source: "USER",
          confirmed: true,
        }));
        return screenshotView(media);
      });
    } catch (error) {
      if (stored) mediaStorage.remove(storageKey);
      throw error;
    }
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

  function readScreenshot(id) {
    if (!mediaStorage) throw badRequest("Media storage is not configured.");
    const media = ownScreenshot(id);
    const buffer = mediaStorage.read(media.storageKey);
    if (!buffer) throw notFound("Screenshot file is missing.");
    return { media, buffer };
  }

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

  function updateScreenshot(id, body, expectedVersion) {
    ownScreenshot(id);
    const source = assertRequestObject(body);
    const mutableFields = ["tradeId", "journalEntryId", "folderId", "originalFilename", "capturedAt", "favorite"];
    const unsupportedFields = Object.keys(source).filter((field) => field !== "expectedVersion" && field !== "version" && !mutableFields.includes(field));
    if (unsupportedFields.length) throw badRequest(`Screenshot field cannot be updated: ${unsupportedFields[0]}.`);
    const fields = Object.fromEntries(mutableFields.filter((field) => Object.prototype.hasOwnProperty.call(source, field)).map((field) => [field, source[field]]));
    return screenshotView(update(id, fields, expectedVersion));
  }

  function removeScreenshot(id, expectedVersion) {
    ownScreenshot(id);
    return remove(id, expectedVersion);
  }

  function discardUploadedScreenshot(id) {
    const media = findMediaById(database, id);
    if (!media || media.userId !== context().userId || media.source !== SCREENSHOT_SOURCE) return;
    withTransaction(database, () => {
      database.prepare("DELETE FROM media_tags WHERE mediaId = ?").run(id);
      database.prepare("DELETE FROM media_categories WHERE mediaId = ?").run(id);
      database.prepare("DELETE FROM media_assets WHERE id = ? AND userId = ? AND source = ?").run(id, context().userId, SCREENSHOT_SOURCE);
    });
    if (mediaStorage) mediaStorage.remove(media.storageKey);
  }

  return {
    create,
    createUploadedScreenshot,
    list,
    listScreenshots,
    get,
    getScreenshot,
    getReference,
    readScreenshot,
    update,
    updateScreenshot,
    remove,
    removeScreenshot,
    discardUploadedScreenshot,
  };
}
