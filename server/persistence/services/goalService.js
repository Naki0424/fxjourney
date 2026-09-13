import { findAccountById } from "../repositories/accountRepository.js";
import {
  findGoalById,
  findMilestoneById,
  insertGoal,
  insertMilestone,
  listGoalsByUserId,
  listMilestonesByGoalId,
  softDeleteGoalByVersion,
  softDeleteMilestoneByVersion,
  softDeleteMilestonesForGoal,
  updateGoalByVersion,
  updateMilestoneByVersion,
} from "../repositories/goalsRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, createId, dateOnlyValue, decimalString, enumValue, integerValue, nowUtc, optionalText, parsePositiveVersion, requiredText, timestampValue, withTransaction } from "../utils.js";

const PROGRESS_MODES = new Set(["AUTOMATIC", "MANUAL"]);
const METRIC_TYPES = new Set(["PROFIT_AMOUNT", "WIN_RATE", "MAX_RISK_PERCENT", "TRADE_FREQUENCY", "PLAN_ADHERENCE", "TRADING_DAYS", "CUSTOM"]);
const GOAL_STATUSES = new Set(["ACTIVE", "COMPLETED", "ARCHIVED"]);
const TARGET_OPERATORS = new Set(["GTE", "LTE", "EQ", "GT", "LT"]);

export function createGoalService({ database, getContext }) {
  const context = () => getContext();

  function ownGoal(id) {
    const goal = findGoalById(database, id);
    if (!goal || goal.userId !== context().userId || goal.deletedAt) throw notFound("Goal not found.");
    return goal;
  }

  function validateAccount(accountId) {
    if (!accountId) return null;
    const account = findAccountById(database, accountId);
    if (!account || account.userId !== context().userId || account.deletedAt) throw notFound("Account not found.");
    return accountId;
  }

  function normalizeFields(source, current = null) {
    const value = current ? { ...current, ...source } : source;
    const fields = {
      accountId: validateAccount(value.accountId || null),
      title: requiredText(value.title, "title", { maxLength: 300 }),
      description: optionalText(value.description, "description", { maxLength: 5000 }),
      progressMode: enumValue(value.progressMode, "progressMode", PROGRESS_MODES),
      metricType: enumValue(value.metricType, "metricType", METRIC_TYPES),
      targetValue: decimalString(value.targetValue, "targetValue"),
      targetUnit: optionalText(value.targetUnit, "targetUnit", { maxLength: 50 }),
      targetOperator: value.targetOperator === undefined || value.targetOperator === null || value.targetOperator === ""
        ? (value.targetValue === undefined || value.targetValue === null || value.targetValue === "" ? null : "GTE")
        : enumValue(value.targetOperator, "targetOperator", TARGET_OPERATORS),
      periodStart: dateOnlyValue(value.periodStart, "periodStart"),
      periodEnd: dateOnlyValue(value.periodEnd, "periodEnd"),
      dueDate: dateOnlyValue(value.dueDate, "dueDate"),
      status: enumValue(value.status, "status", GOAL_STATUSES, { defaultValue: current ? undefined : "ACTIVE" }),
      completedAt: timestampValue(value.completedAt, "completedAt"),
      manualCurrentValue: decimalString(value.manualCurrentValue, "manualCurrentValue"),
      rule: value.rule === undefined ? null : value.rule,
    };
    if (fields.periodStart && fields.periodEnd && fields.periodEnd < fields.periodStart) throw badRequest("periodEnd cannot precede periodStart.");
    if (fields.status === "COMPLETED" && !fields.completedAt) throw badRequest("COMPLETED goals must include completedAt.");
    if (fields.status !== "COMPLETED" && fields.completedAt) throw badRequest("Only COMPLETED goals may include completedAt.");
    if (fields.targetOperator && !fields.targetValue) throw badRequest("targetOperator requires targetValue.");
    if (fields.targetValue && !fields.targetOperator) throw badRequest("targetValue requires targetOperator.");
    return fields;
  }

  function create(body) {
    const fields = normalizeFields(assertRequestObject(body));
    const timestamp = nowUtc();
    return insertGoal(database, {
      id: createId(), userId: context().userId, ...fields, createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function list() { return listGoalsByUserId(database, context().userId); }
  function get(id) { return ownGoal(id); }

  function update(id, body, expectedVersion) {
    const current = ownGoal(id);
    const fields = normalizeFields(assertRequestObject(body), current);
    const updated = updateGoalByVersion(database, { ...current, ...fields, updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The goal was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function remove(id, expectedVersion) {
    const current = ownGoal(id);
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      const deleted = softDeleteGoalByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
      if (!deleted) throw conflict("The goal was changed by another operation.", "STALE_VERSION");
      softDeleteMilestonesForGoal(database, id, timestamp, context().deviceId);
      return deleted;
    });
  }

  function createMilestone(goalId, body) {
    ownGoal(goalId);
    const source = assertRequestObject(body);
    const timestamp = nowUtc();
    return insertMilestone(database, {
      id: createId(), goalId, title: requiredText(source.title, "title", { maxLength: 300 }),
      targetDate: dateOnlyValue(source.targetDate, "targetDate"), achievedAt: timestampValue(source.achievedAt, "achievedAt"),
      sortOrder: integerValue(source.sortOrder, "sortOrder"), createdAt: timestamp, updatedAt: timestamp,
      deletedAt: null, version: 1, originDeviceId: context().deviceId, lastModifiedByDeviceId: context().deviceId,
    });
  }

  function listMilestones(goalId) { ownGoal(goalId); return listMilestonesByGoalId(database, goalId); }
  function getMilestone(goalId, milestoneId) {
    ownGoal(goalId);
    const milestone = findMilestoneById(database, milestoneId);
    if (!milestone || milestone.goalId !== goalId || milestone.deletedAt) throw notFound("Goal milestone not found.");
    return milestone;
  }

  function updateMilestone(goalId, milestoneId, body, expectedVersion) {
    const current = getMilestone(goalId, milestoneId);
    const source = assertRequestObject(body);
    const updated = updateMilestoneByVersion(database, {
      ...current,
      title: source.title === undefined ? current.title : requiredText(source.title, "title", { maxLength: 300 }),
      targetDate: source.targetDate === undefined ? current.targetDate : dateOnlyValue(source.targetDate, "targetDate"),
      achievedAt: source.achievedAt === undefined ? current.achievedAt : timestampValue(source.achievedAt, "achievedAt"),
      sortOrder: source.sortOrder === undefined ? current.sortOrder : integerValue(source.sortOrder, "sortOrder"),
      updatedAt: nowUtc(), lastModifiedByDeviceId: context().deviceId,
    }, parsePositiveVersion(expectedVersion));
    if (!updated) throw conflict("The goal milestone was changed by another operation.", "STALE_VERSION");
    return updated;
  }

  function removeMilestone(goalId, milestoneId, expectedVersion) {
    const current = getMilestone(goalId, milestoneId);
    const timestamp = nowUtc();
    const deleted = softDeleteMilestoneByVersion(database, { ...current, deletedAt: timestamp, updatedAt: timestamp, deviceId: context().deviceId }, parsePositiveVersion(expectedVersion));
    if (!deleted) throw conflict("The goal milestone was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  return { create, list, get, update, remove, createMilestone, listMilestones, getMilestone, updateMilestone, removeMilestone };
}
