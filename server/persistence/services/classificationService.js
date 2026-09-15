import { findTradeById } from "../repositories/tradeRepository.js";
import { findJournalEntryById } from "../repositories/journalRepository.js";
import { findMediaById } from "../repositories/mediaRepository.js";
import {
  findActiveRelationship,
  findCategoryById,
  findFolderById,
  findTagById,
  findActiveTagByNormalizedName,
  insertCategory,
  insertFolder,
  insertRelationship,
  insertTag,
  listCategoriesByUserId,
  listFoldersByUserId,
  listRelationships,
  listTagsByUserId,
  softDeleteCategoryByVersion,
  softDeleteFolderByVersion,
  softDeleteRelationshipByVersion,
  softDeleteTagByVersion,
  softDeleteRelationshipsForParent,
  updateCategoryByVersion,
  updateFolderByVersion,
  updateTagByVersion,
  updateMediaCategoryByVersion,
} from "../repositories/classificationRepository.js";
import { detachMediaFromFolder } from "../repositories/mediaRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, booleanValue, createId, decimalString, enumValue, integerValue, nowUtc, optionalText, parsePositiveVersion, requiredText, withTransaction } from "../utils.js";

const CATEGORY_SOURCES = new Set(["AI", "USER"]);

export function normalizeTagName(value) {
  return requiredText(value, "name", { maxLength: 100 }).replace(/\s+/g, " ");
}

function normalizedName(value) {
  return value.trim().toLocaleLowerCase();
}

export function createClassificationService({ database, getContext }) {
  const context = () => getContext();

  function ownTag(id) {
    const tag = findTagById(database, id);
    if (!tag || tag.userId !== context().userId || tag.deletedAt) throw notFound("Tag not found.");
    return tag;
  }

  function ownCategory(id, { allowSystem = true } = {}) {
    const category = findCategoryById(database, id);
    if (!category || category.deletedAt || (category.userId !== context().userId && !(allowSystem && category.userId === null))) {
      throw notFound("Category not found.");
    }
    return category;
  }

  function ownFolder(id) {
    const folder = findFolderById(database, id);
    if (!folder || folder.userId !== context().userId || folder.deletedAt) throw notFound("Folder not found.");
    return folder;
  }

  function ownTrade(id) {
    const trade = findTradeById(database, id);
    if (!trade || trade.userId !== context().userId || trade.deletedAt) throw notFound("Trade not found.");
    return trade;
  }

  function ownJournal(id) {
    const entry = findJournalEntryById(database, id);
    if (!entry || entry.userId !== context().userId || entry.deletedAt) throw notFound("Journal entry not found.");
    return entry;
  }

  function ownMedia(id) {
    const media = findMediaById(database, id);
    if (!media || media.userId !== context().userId || media.deletedAt) throw notFound("Media not found.");
    return media;
  }

  function createTag(body) {
    const source = assertRequestObject(body);
    const name = normalizeTagName(source.name);
    const normalized = normalizedName(name);
    if (findActiveTagByNormalizedName(database, context().userId, normalized)) {
      throw conflict("An active tag with this name already exists.", "DUPLICATE_TAG");
    }
    const timestamp = nowUtc();
    return insertTag(database, {
      id: createId(), userId: context().userId, name, normalizedName: normalized,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1,
      originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function ensureTag(name) {
    const tagName = normalizeTagName(name);
    const normalized = normalizedName(tagName);
    const existing = findActiveTagByNormalizedName(database, context().userId, normalized);
    if (existing) return existing;
    const timestamp = nowUtc();
    return insertTag(database, {
      id: createId(), userId: context().userId, name: tagName, normalizedName: normalized,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1,
      originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function updateTag(id, body, expectedVersion) {
    const source = assertRequestObject(body);
    const current = ownTag(id);
    const version = parsePositiveVersion(expectedVersion);
    const name = normalizeTagName(source.name);
    const normalized = normalizedName(name);
    const duplicate = findActiveTagByNormalizedName(database, context().userId, normalized);
    if (duplicate && duplicate.id !== id) throw conflict("An active tag with this name already exists.", "DUPLICATE_TAG");
    const updated = updateTagByVersion(database, { ...current, name, normalizedName: normalized, updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId }, version);
    if (!updated) throw conflict("The tag was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function removeTag(id, expectedVersion) {
    const current = ownTag(id);
    const deleted = softDeleteTagByVersion(database, { ...current, deletedAt: nowUtc(), updatedAt: nowUtc(), deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The tag was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  function createCategory(body) {
    const source = assertRequestObject(body);
    if (source.source !== undefined && source.source !== "USER") throw badRequest("User-created categories must use source USER.");
    const name = requiredText(source.name, "name", { maxLength: 150 });
    const timestamp = nowUtc();
    return insertCategory(database, {
      id: createId(), userId: context().userId, name, normalizedName: normalizedName(name),
      groupName: optionalText(source.groupName, "groupName"), description: optionalText(source.description, "description", { maxLength: 2000 }),
      source: "USER", icon: optionalText(source.icon, "icon", { maxLength: 100 }), createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function updateCategory(id, body, expectedVersion) {
    const source = assertRequestObject(body);
    const current = ownCategory(id, { allowSystem: false });
    const name = source.name === undefined ? current.name : requiredText(source.name, "name", { maxLength: 150 });
    const updated = updateCategoryByVersion(database, {
      ...current, name, normalizedName: normalizedName(name),
      groupName: source.groupName === undefined ? current.groupName : optionalText(source.groupName, "groupName"),
      description: source.description === undefined ? current.description : optionalText(source.description, "description", { maxLength: 2000 }),
      icon: source.icon === undefined ? current.icon : optionalText(source.icon, "icon", { maxLength: 100 }),
      updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId,
    }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The category was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function removeCategory(id, expectedVersion) {
    const current = ownCategory(id, { allowSystem: false });
    const timestamp = nowUtc();
    const deleted = softDeleteCategoryByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The category was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  function createFolder(body) {
    const source = assertRequestObject(body);
    const timestamp = nowUtc();
    return insertFolder(database, {
      id: createId(), userId: context().userId, name: requiredText(source.name, "name", { maxLength: 150 }),
      sortOrder: integerValue(source.sortOrder, "sortOrder"), createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function updateFolder(id, body, expectedVersion) {
    const source = assertRequestObject(body);
    const current = ownFolder(id);
    const updated = updateFolderByVersion(database, {
      ...current,
      name: source.name === undefined ? current.name : requiredText(source.name, "name", { maxLength: 150 }),
      sortOrder: source.sortOrder === undefined ? current.sortOrder : integerValue(source.sortOrder, "sortOrder"),
      updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId,
    }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The folder was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function removeFolder(id, expectedVersion) {
    const current = ownFolder(id);
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      const deleted = softDeleteFolderByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
      if (!deleted) throw conflict("The folder was changed by another operation.", "STALE_VERSION");
      detachMediaFromFolder(database, id, timestamp, context().deviceId);
      return deleted;
    });
  }

  function attachTag(table, parentColumn, parentId, tagId) {
    const tag = ownTag(requiredText(tagId, "tagId"));
    const existing = findActiveRelationship(database, table, parentColumn, parentId, "tagId", tag.id);
    if (existing) throw conflict("This tag is already attached.", "DUPLICATE_RELATIONSHIP");
    const timestamp = nowUtc();
    return insertRelationship(database, table, {
      id: createId(), [parentColumn]: parentId, tagId: tag.id, createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function listTags(table, parentColumn, parentId) {
    return listRelationships(database, table, parentColumn, parentId).map((relationship) => ({
      ...relationship,
      tag: findTagById(database, relationship.tagId),
    }));
  }

  function detachRelationship(table, parentColumn, targetColumn, parentId, targetId, expectedVersion) {
    const relationship = findActiveRelationship(database, table, parentColumn, parentId, targetColumn, targetId);
    if (!relationship) throw notFound("Tag relationship not found.");
    const deleted = softDeleteRelationshipByVersion(database, table, { ...relationship, updatedAt: nowUtc(), deletedAt: nowUtc(), deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The tag relationship was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  function detachTag(table, parentColumn, parentId, tagId, expectedVersion) {
    return detachRelationship(table, parentColumn, "tagId", parentId, tagId, expectedVersion);
  }

  function attachTradeTag(tradeId, tagId) { ownTrade(tradeId); return attachTag("trade_tags", "tradeId", tradeId, tagId); }
  function listTradeTags(tradeId) { ownTrade(tradeId); return listTags("trade_tags", "tradeId", tradeId); }
  function detachTradeTag(tradeId, tagId, expectedVersion) { ownTrade(tradeId); return detachTag("trade_tags", "tradeId", tradeId, tagId, expectedVersion); }
  function attachJournalTag(journalEntryId, tagId) { ownJournal(journalEntryId); return attachTag("journal_tags", "journalEntryId", journalEntryId, tagId); }
  function listJournalTags(journalEntryId) { ownJournal(journalEntryId); return listTags("journal_tags", "journalEntryId", journalEntryId); }
  function detachJournalTag(journalEntryId, tagId, expectedVersion) { ownJournal(journalEntryId); return detachTag("journal_tags", "journalEntryId", journalEntryId, tagId, expectedVersion); }
  function attachMediaTag(mediaId, tagId) { ownMedia(mediaId); return attachTag("media_tags", "mediaId", mediaId, tagId); }
  function listMediaTags(mediaId) { ownMedia(mediaId); return listTags("media_tags", "mediaId", mediaId); }
  function detachMediaTag(mediaId, tagId, expectedVersion) { ownMedia(mediaId); return detachTag("media_tags", "mediaId", mediaId, tagId, expectedVersion); }

  function attachMediaCategory(mediaId, body) {
    ownMedia(mediaId);
    const source = assertRequestObject(body);
    const category = ownCategory(requiredText(source.categoryId, "categoryId"));
    if (findActiveRelationship(database, "media_categories", "mediaId", mediaId, "categoryId", category.id)) {
      throw conflict("This category is already attached.", "DUPLICATE_RELATIONSHIP");
    }
    const timestamp = nowUtc();
    return insertRelationship(database, "media_categories", {
      id: createId(), mediaId, categoryId: category.id, source: enumValue(source.source, "source", CATEGORY_SOURCES, { defaultValue: "USER" }),
      confidence: decimalString(source.confidence, "confidence"), confirmed: booleanValue(source.confirmed, "confirmed", { defaultValue: false }) ? 1 : 0,
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1,
      originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function listMediaCategories(mediaId) {
    ownMedia(mediaId);
    return listRelationships(database, "media_categories", "mediaId", mediaId).map((relationship) => ({
      ...relationship,
      category: findCategoryById(database, relationship.categoryId),
    }));
  }

  function updateMediaCategory(mediaId, categoryId, body, expectedVersion) {
    ownMedia(mediaId);
    const relationship = findActiveRelationship(database, "media_categories", "mediaId", mediaId, "categoryId", categoryId);
    if (!relationship) throw notFound("Media category relationship not found.");
    const source = assertRequestObject(body);
    const updated = updateMediaCategoryByVersion(database, {
      ...relationship,
      source: enumValue(source.source, "source", CATEGORY_SOURCES, { defaultValue: relationship.source }),
      confidence: source.confidence === undefined ? relationship.confidence : decimalString(source.confidence, "confidence"),
      confirmed: source.confirmed === undefined ? relationship.confirmed : booleanValue(source.confirmed, "confirmed"),
      updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId,
    }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The media category relationship was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function detachMediaCategory(mediaId, categoryId, expectedVersion) {
    ownMedia(mediaId);
    return detachRelationship("media_categories", "mediaId", "categoryId", mediaId, categoryId, expectedVersion);
  }

  return {
    createTag, ensureTag, getTag: ownTag, listTags: () => listTagsByUserId(database, context().userId), updateTag, removeTag,
    createCategory, getCategory: ownCategory, listCategories: () => listCategoriesByUserId(database, context().userId), updateCategory, removeCategory,
    createFolder, getFolder: ownFolder, listFolders: () => listFoldersByUserId(database, context().userId), updateFolder, removeFolder,
    attachTradeTag, listTradeTags, detachTradeTag,
    attachJournalTag, listJournalTags, detachJournalTag,
    attachMediaTag, listMediaTags, detachMediaTag,
    attachMediaCategory, updateMediaCategory, listMediaCategories, detachMediaCategory,
    softDeleteJournalTags: (journalEntryId, timestamp) => softDeleteRelationshipsForParent(database, "journal_tags", "journalEntryId", journalEntryId, timestamp, context().deviceId),
    softDeleteTradeTags: (tradeId, timestamp) => softDeleteRelationshipsForParent(database, "trade_tags", "tradeId", tradeId, timestamp, context().deviceId),
  };
}
