import { findActiveReflectionByWeek, findReflectionById, insertReflection, listReflectionsByUserId, softDeleteReflectionByVersion, updateReflectionByVersion } from "../repositories/reflectionRepository.js";
import { assertRequestObject, createId, dateOnlyValue, nowUtc, parsePositiveVersion, requiredText } from "../utils.js";
import { conflict, notFound } from "../errors.js";

export function createReflectionService({ database, getContext }) {
  const context = () => getContext();

  function ownReflection(id) {
    const reflection = findReflectionById(database, id);
    if (!reflection || reflection.userId !== context().userId || reflection.deletedAt) throw notFound("Weekly reflection not found.");
    return reflection;
  }

  function create(body) {
    const source = assertRequestObject(body);
    const weekStart = dateOnlyValue(source.weekStart, "weekStart", { nullable: false });
    if (findActiveReflectionByWeek(database, context().userId, weekStart)) throw conflict("A reflection already exists for this week.", "DUPLICATE_WEEK");
    const timestamp = nowUtc();
    return insertReflection(database, {
      id: createId(), userId: context().userId, weekStart, body: requiredText(source.body, "body", { maxLength: 50000 }),
      createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1,
      originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function list() { return listReflectionsByUserId(database, context().userId); }
  function get(id) { return ownReflection(id); }

  function update(id, body, expectedVersion) {
    const current = ownReflection(id);
    const source = assertRequestObject(body);
    const weekStart = source.weekStart === undefined ? current.weekStart : dateOnlyValue(source.weekStart, "weekStart", { nullable: false });
    const duplicate = findActiveReflectionByWeek(database, context().userId, weekStart);
    if (duplicate && duplicate.id !== id) throw conflict("A reflection already exists for this week.", "DUPLICATE_WEEK");
    const updated = updateReflectionByVersion(database, {
      ...current, weekStart, body: source.body === undefined ? current.body : requiredText(source.body, "body", { maxLength: 50000 }),
      updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId,
    }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The reflection was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function remove(id, expectedVersion) {
    const current = ownReflection(id);
    const timestamp = nowUtc();
    const deleted = softDeleteReflectionByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The reflection was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  return { create, list, get, update, remove };
}
