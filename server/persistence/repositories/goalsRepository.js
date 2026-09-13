import { jsonValue, parseJsonColumn } from "../utils.js";

function mapGoal(row) {
  if (!row) return null;
  const { ruleJson, ...goal } = row;
  return { ...goal, rule: parseJsonColumn(ruleJson, "rule") };
}

function mapMilestone(row) { return row ? { ...row } : null; }

export function findGoalById(database, id) { return mapGoal(database.prepare("SELECT * FROM goals WHERE id = ?").get(id)); }
export function listGoalsByUserId(database, userId) { return database.prepare("SELECT * FROM goals WHERE userId = ? AND deletedAt IS NULL ORDER BY createdAt DESC, id DESC").all(userId).map(mapGoal); }
export function insertGoal(database, goal) {
  database.prepare(`INSERT INTO goals (id, userId, accountId, title, description, progressMode, metricType, targetValue, targetUnit, targetOperator, periodStart, periodEnd, dueDate, status, completedAt, manualCurrentValue, ruleJson, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @userId, @accountId, @title, @description, @progressMode, @metricType, @targetValue, @targetUnit, @targetOperator, @periodStart, @periodEnd, @dueDate, @status, @completedAt, @manualCurrentValue, @ruleJson, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run({ ...goal, ruleJson: jsonValue(goal.rule, "rule") });
  return findGoalById(database, goal.id);
}
export function updateGoalByVersion(database, goal, expectedVersion) {
  const result = database.prepare(`UPDATE goals SET accountId = @accountId, title = @title, description = @description, progressMode = @progressMode, metricType = @metricType, targetValue = @targetValue, targetUnit = @targetUnit, targetOperator = @targetOperator, periodStart = @periodStart, periodEnd = @periodEnd, dueDate = @dueDate, status = @status, completedAt = @completedAt, manualCurrentValue = @manualCurrentValue, ruleJson = @ruleJson, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...goal, ruleJson: jsonValue(goal.rule, "rule"), expectedVersion });
  return result.changes === 1 ? findGoalById(database, goal.id) : null;
}
export function softDeleteGoalByVersion(database, goal, expectedVersion) {
  const result = database.prepare("UPDATE goals SET status = 'ARCHIVED', deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL").run(goal.deletedAt, goal.updatedAt, goal.deviceId, goal.id, goal.userId, expectedVersion);
  return result.changes === 1 ? findGoalById(database, goal.id) : null;
}

export function findMilestoneById(database, id) { return mapMilestone(database.prepare("SELECT * FROM goal_milestones WHERE id = ?").get(id)); }
export function listMilestonesByGoalId(database, goalId) { return database.prepare("SELECT * FROM goal_milestones WHERE goalId = ? AND deletedAt IS NULL ORDER BY sortOrder IS NULL, sortOrder ASC, targetDate IS NULL, targetDate ASC, id ASC").all(goalId).map(mapMilestone); }
export function insertMilestone(database, milestone) {
  database.prepare(`INSERT INTO goal_milestones (id, goalId, title, targetDate, achievedAt, sortOrder, createdAt, updatedAt, deletedAt, version, originDeviceId, lastModifiedByDeviceId) VALUES (@id, @goalId, @title, @targetDate, @achievedAt, @sortOrder, @createdAt, @updatedAt, @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId)`).run(milestone);
  return findMilestoneById(database, milestone.id);
}
export function updateMilestoneByVersion(database, milestone, expectedVersion) {
  const result = database.prepare(`UPDATE goal_milestones SET title = @title, targetDate = @targetDate, achievedAt = @achievedAt, sortOrder = @sortOrder, updatedAt = @updatedAt, version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId WHERE id = @id AND version = @expectedVersion AND deletedAt IS NULL`).run({ ...milestone, expectedVersion });
  return result.changes === 1 ? findMilestoneById(database, milestone.id) : null;
}
export function softDeleteMilestoneByVersion(database, milestone, expectedVersion) {
  const result = database.prepare("UPDATE goal_milestones SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE id = ? AND version = ? AND deletedAt IS NULL").run(milestone.deletedAt, milestone.updatedAt, milestone.deviceId, milestone.id, expectedVersion);
  return result.changes === 1 ? findMilestoneById(database, milestone.id) : null;
}
export function softDeleteMilestonesForGoal(database, goalId, updatedAt, deviceId) {
  database.prepare("UPDATE goal_milestones SET deletedAt = ?, updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ? WHERE goalId = ? AND deletedAt IS NULL").run(updatedAt, updatedAt, deviceId, goalId);
}
