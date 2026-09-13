import { jsonValue, parseJsonColumn } from "../utils.js";

function mapHabit(row) {
  if (!row) return null;
  const { expectedWeekdaysJson, ...habit } = row;
  return { ...habit, active: Boolean(habit.active), expectedWeekdays: parseJsonColumn(expectedWeekdaysJson, "expectedWeekdays") };
}

function mapEntry(row) { return row ? { ...row } : null; }

export function findHabitById(database, id) { return mapHabit(database.prepare("SELECT * FROM habits WHERE id = ?").get(id)); }
export function listHabitsByUserId(database, userId) { return database.prepare("SELECT * FROM habits WHERE userId = ? AND active = 1 AND deletedAt IS NULL ORDER BY sortOrder IS NULL, sortOrder ASC, name ASC, id ASC").all(userId).map(mapHabit); }
export function insertHabit(database, habit) {
  database.prepare(`INSERT INTO habits (id, userId, name, description, frequency, expectedWeekdaysJson, active, sortOrder, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @userId, @name, @description, @frequency, @expectedWeekdaysJson, @active, @sortOrder, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run({ ...habit, expectedWeekdaysJson: jsonValue(habit.expectedWeekdays, "expectedWeekdays"), active: habit.active ? 1 : 0 });
  return findHabitById(database, habit.id);
}
export function updateHabitByVersion(database, habit, expectedVersion) {
  const result = database.prepare(`UPDATE habits SET name = @name, description = @description, frequency = @frequency, expectedWeekdaysJson = @expectedWeekdaysJson, active = @active, sortOrder = @sortOrder, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...habit, expectedWeekdaysJson: jsonValue(habit.expectedWeekdays, "expectedWeekdays"), active: habit.active ? 1 : 0, expectedVersion });
  return result.changes === 1 ? findHabitById(database, habit.id) : null;
}
export function softDeleteHabitByVersion(database, habit, expectedVersion) {
  const result = database.prepare("UPDATE habits SET active = 0, deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL").run(habit.deletedAt, habit.updatedAt, habit.deviceId, habit.id, habit.userId, expectedVersion);
  return result.changes === 1 ? findHabitById(database, habit.id) : null;
}
export function softDeleteEntriesForHabit(database, habitId, updatedAt, deviceId) {
  database.prepare("UPDATE habit_entries SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE habitId = ? AND deletedAt IS NULL").run(updatedAt, updatedAt, deviceId, habitId);
}

export function findEntryById(database, id) { return mapEntry(database.prepare("SELECT * FROM habit_entries WHERE id = ?").get(id)); }
export function findActiveEntryByDate(database, habitId, entryDate) { return mapEntry(database.prepare("SELECT * FROM habit_entries WHERE habitId = ? AND entryDate = ? AND deletedAt IS NULL").get(habitId, entryDate)); }
export function listEntries(database, habitId, { from, to } = {}) {
  const conditions = ["habitId = @habitId", "deletedAt IS NULL"];
  const parameters = { habitId };
  if (from) { conditions.push("entryDate >= @from"); parameters.from = from; }
  if (to) { conditions.push("entryDate <= @to"); parameters.to = to; }
  return database.prepare(`SELECT * FROM habit_entries WHERE ${conditions.join(" AND ")} ORDER BY entryDate ASC, id ASC`).all(parameters).map(mapEntry);
}
export function insertEntry(database, entry) {
  database.prepare(`INSERT INTO habit_entries (id, habitId, entryDate, status, note, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @habitId, @entryDate, @status, @note, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run(entry);
  return findEntryById(database, entry.id);
}
export function updateEntryByVersion(database, entry, expectedVersion) {
  const result = database.prepare(`UPDATE habit_entries SET entryDate = @entryDate, status = @status, note = @note, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...entry, expectedVersion });
  return result.changes === 1 ? findEntryById(database, entry.id) : null;
}
export function softDeleteEntryByVersion(database, entry, expectedVersion) {
  const result = database.prepare("UPDATE habit_entries SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND version = ? AND deletedAt IS NULL").run(entry.deletedAt, entry.updatedAt, entry.deviceId, entry.id, expectedVersion);
  return result.changes === 1 ? findEntryById(database, entry.id) : null;
}
