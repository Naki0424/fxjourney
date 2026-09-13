import {
  findActiveEntryByDate,
  findEntryById,
  findHabitById,
  insertEntry,
  insertHabit,
  listEntries,
  listHabitsByUserId,
  softDeleteEntriesForHabit,
  softDeleteEntryByVersion,
  softDeleteHabitByVersion,
  updateEntryByVersion,
  updateHabitByVersion,
} from "../repositories/habitsRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, booleanValue, createId, dateOnlyValue, enumValue, integerValue, jsonValue, nowUtc, optionalText, parsePositiveVersion, requiredText, withTransaction } from "../utils.js";

const FREQUENCIES = new Set(["DAILY", "WEEKLY", "CUSTOM"]);
const ENTRY_STATUSES = new Set(["COMPLETED", "MISSED", "SKIPPED", "NOT_APPLICABLE"]);

export function createHabitService({ database, getContext }) {
  const context = () => getContext();

  function ownHabit(id) {
    const habit = findHabitById(database, id);
    if (!habit || habit.userId !== context().userId || habit.deletedAt) throw notFound("Habit not found.");
    return habit;
  }

  function ownEntry(habitId, entryId) {
    ownHabit(habitId);
    const entry = findEntryById(database, entryId);
    if (!entry || entry.habitId !== habitId || entry.deletedAt) throw notFound("Habit entry not found.");
    return entry;
  }

  function normalizeHabitFields(source, current = null) {
    const value = current ? { ...current, ...source } : source;
    const expectedWeekdays = value.expectedWeekdays === undefined ? null : value.expectedWeekdays;
    if (expectedWeekdays !== null) {
      if (!Array.isArray(expectedWeekdays)) throw badRequest("expectedWeekdays must be an array.");
      jsonValue(expectedWeekdays, "expectedWeekdays");
    }
    return {
      name: requiredText(value.name, "name", { maxLength: 300 }),
      description: optionalText(value.description, "description", { maxLength: 5000 }),
      frequency: enumValue(value.frequency, "frequency", FREQUENCIES),
      expectedWeekdays,
      active: booleanValue(value.active, "active", { defaultValue: current ? undefined : true }),
      sortOrder: integerValue(value.sortOrder, "sortOrder"),
    };
  }

  function create(body) {
    const fields = normalizeHabitFields(assertRequestObject(body));
    const timestamp = nowUtc();
    return insertHabit(database, {
      id: createId(), userId: context().userId, ...fields, createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function list() { return listHabitsByUserId(database, context().userId); }
  function get(id) { return ownHabit(id); }

  function update(id, body, expectedVersion) {
    const current = ownHabit(id);
    const fields = normalizeHabitFields(assertRequestObject(body), current);
    const updated = updateHabitByVersion(database, { ...current, ...fields, updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The habit was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function remove(id, expectedVersion) {
    const current = ownHabit(id);
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      const deleted = softDeleteHabitByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
      if (!deleted) throw conflict("The habit was changed by another operation.", "STALE_VERSION");
      softDeleteEntriesForHabit(database, id, timestamp, context().deviceId);
      return deleted;
    });
  }

  function normalizeEntry(source) {
    return {
      entryDate: dateOnlyValue(source.entryDate, "entryDate", { nullable: false }),
      status: enumValue(source.status, "status", ENTRY_STATUSES),
      note: optionalText(source.note, "note", { maxLength: 5000 }),
    };
  }

  function setEntry(habitId, body, expectedVersion) {
    ownHabit(habitId);
    const fields = normalizeEntry(assertRequestObject(body));
    const current = findActiveEntryByDate(database, habitId, fields.entryDate);
    if (current) {
      if (expectedVersion === undefined || expectedVersion === null || expectedVersion === "") {
        throw conflict("A habit entry already exists for this date; provide expectedVersion to update it.", "DUPLICATE_ENTRY");
      }
      const updated = updateEntryByVersion(database, { ...current, ...fields, updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
      if (!updated) throw conflict("The habit entry was changed by another operation.", "STALE_VERSION");
      return updated;
    }
    const timestamp = nowUtc();
    return insertEntry(database, {
      id: createId(), habitId, ...fields, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function getEntry(habitId, entryDate) {
    ownHabit(habitId);
    const entry = findActiveEntryByDate(database, habitId, dateOnlyValue(entryDate, "entryDate", { nullable: false }));
    if (!entry) throw notFound("Habit entry not found.");
    return entry;
  }

  function listEntriesForHabit(habitId, from, to) {
    ownHabit(habitId);
    const range = {
      from: dateOnlyValue(from, "from"),
      to: dateOnlyValue(to, "to"),
    };
    if (range.from && range.to && range.to < range.from) throw badRequest("to cannot precede from.");
    return listEntries(database, habitId, range);
  }

  function updateEntry(habitId, entryId, body, expectedVersion) {
    const current = ownEntry(habitId, entryId);
    const source = assertRequestObject(body);
    const fields = normalizeEntry({ ...current, ...source });
    const updated = updateEntryByVersion(database, { ...current, ...fields, updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The habit entry was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function removeEntry(habitId, entryId, expectedVersion) {
    const current = ownEntry(habitId, entryId);
    const timestamp = nowUtc();
    const deleted = softDeleteEntryByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The habit entry was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  return { create, list, get, update, remove, setEntry, getEntry, listEntries: listEntriesForHabit, updateEntry, removeEntry };
}
