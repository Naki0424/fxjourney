import { findAccountById, insertAccount, applyAccountSnapshot } from "./repositories/accountRepository.js";
import { findTradeById, insertTrade, applyTradeSnapshot } from "./repositories/tradeRepository.js";
import { canonicalJson } from "./syncRepository.js";
import { isUuid } from "./utils.js";

export const SYNC_PROTOCOL_VERSION = "1";
export const SYNC_PAYLOAD_SCHEMA_VERSION = "1";
export const SYNC_ENTITY_TYPES = new Set(["ACCOUNT", "TRADE"]);
export const SYNC_OPERATIONS = new Set(["CREATE", "UPDATE", "DELETE"]);

const ACCOUNT_FIELDS = [
  "id", "userId", "name", "brokerName", "accountType", "currencyCode",
  "currencyMinorDigits", "initialBalanceMinor", "active", "createdAt",
  "updatedAt", "deletedAt", "version", "originDeviceId", "lastModifiedByDeviceId",
];

const TRADE_FIELDS = [
  "id", "userId", "accountId", "instrument", "direction", "status", "outcome",
  "openedAt", "closedAt", "entryPrice", "exitPrice", "stopLossPrice",
  "takeProfitTargets", "quantityLots", "accountEquityAtEntryMinor", "riskAmountMinor",
  "riskPercent", "pnlAmountMinor", "setupType", "confluence", "tradePlan",
  "emotionBefore", "emotionDuring", "emotionAfter", "emotions", "review", "notes",
  "rating", "planAdherence", "createdAt", "updatedAt", "deletedAt", "version",
  "originDeviceId", "lastModifiedByDeviceId",
];

// Sync-1 deliberately excludes trade_tags and all other classification,
// media, journal, Analyzer, goal, and dashboard data. Trade tags remain a
// later dependency-aware replication phase.

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function canonicalSnapshot(entityType, entity) {
  const fields = fieldsForEntity(entityType);
  return Object.fromEntries(fields.map((field) => [field, entity[field] ?? null]));
}

export function fieldsForEntity(entityType) {
  if (entityType === "ACCOUNT") return ACCOUNT_FIELDS;
  if (entityType === "TRADE") return TRADE_FIELDS;
  throw new SyncValidationError(`Unsupported sync entity type: ${entityType}`);
}

export function changedFields(entityType, before, after, operation) {
  const fields = fieldsForEntity(entityType);
  if (operation === "CREATE") return fields;
  if (operation === "DELETE") return entityType === "ACCOUNT"
    ? ["active", "deletedAt", "updatedAt", "version", "lastModifiedByDeviceId"]
    : ["deletedAt", "updatedAt", "version", "lastModifiedByDeviceId"];
  return fields.filter((field) => canonicalJson(before?.[field] ?? null) !== canonicalJson(after?.[field] ?? null));
}

export function dependenciesFor(entityType, payload) {
  const dependencies = [{ entityType: "USER", entityId: payload.userId }];
  if (entityType === "TRADE") {
    dependencies.push({ entityType: "ACCOUNT", entityId: payload.accountId });
  }
  return dependencies;
}

export function validateSnapshot(entityType, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SyncValidationError("Sync payload must be an object.");
  }
  if (entityType === "ACCOUNT") validateAccount(payload);
  else if (entityType === "TRADE") validateTrade(payload);
  else throw new SyncValidationError(`Unsupported sync entity type: ${entityType}`);
}

export function applyAccountCreate(database, payload) {
  return insertAccount(database, payload);
}

export function applyAccountSnapshotToDatabase(database, payload) {
  return applyAccountSnapshot(database, payload);
}

export function applyTradeCreate(database, payload) {
  return insertTrade(database, payload);
}

export function applyTradeSnapshotToDatabase(database, payload) {
  return applyTradeSnapshot(database, payload);
}

export function findEntity(database, entityType, entityId) {
  if (entityType === "ACCOUNT") return findAccountById(database, entityId);
  if (entityType === "TRADE") return findTradeById(database, entityId);
  throw new SyncValidationError(`Unsupported sync entity type: ${entityType}`);
}

function validateAccount(account) {
  validateCommonSnapshot(account);
  requiredUuid(account.id, "Account id");
  requiredText(account.name, "Account name");
  if (!/^[A-Z]{3}$/.test(account.currencyCode)) throw new SyncValidationError("Account currencyCode is invalid.");
  if (!Number.isSafeInteger(account.currencyMinorDigits) || account.currencyMinorDigits < 0 || account.currencyMinorDigits > 9) {
    throw new SyncValidationError("Account currencyMinorDigits is invalid.");
  }
  if (typeof account.active !== "boolean") throw new SyncValidationError("Account active must be boolean.");
  optionalSafeInteger(account.initialBalanceMinor, "Account initialBalanceMinor");
}

function validateTrade(trade) {
  validateCommonSnapshot(trade);
  requiredUuid(trade.id, "Trade id");
  requiredUuid(trade.accountId, "Trade accountId");
  requiredText(trade.instrument, "Trade instrument");
  if (!["BUY", "SELL"].includes(trade.direction)) throw new SyncValidationError("Trade direction is invalid.");
  if (!["DRAFT", "OPEN", "CLOSED", "CANCELLED"].includes(trade.status)) throw new SyncValidationError("Trade status is invalid.");
  if (!["WIN", "LOSS", "BREAKEVEN", "UNRESOLVED"].includes(trade.outcome)) throw new SyncValidationError("Trade outcome is invalid.");
  if (!["FOLLOWED", "PARTIAL", "BROKE_PLAN", "NOT_RATED"].includes(trade.planAdherence)) throw new SyncValidationError("Trade planAdherence is invalid.");
  for (const field of ["entryPrice", "exitPrice", "stopLossPrice", "riskPercent"]) optionalDecimal(trade[field], field);
  optionalPositiveDecimal(trade.quantityLots, "quantityLots");
  for (const field of ["takeProfitTargets", "confluence", "tradePlan", "emotions", "review"]) optionalJson(trade[field], field);
  for (const field of ["accountEquityAtEntryMinor", "riskAmountMinor", "pnlAmountMinor"]) optionalSafeInteger(trade[field], field);
  if (trade.rating !== null && (!Number.isSafeInteger(trade.rating) || trade.rating < 1 || trade.rating > 5)) {
    throw new SyncValidationError("Trade rating is invalid.");
  }
  for (const field of ["emotionBefore", "emotionDuring", "emotionAfter", "setupType", "notes"]) optionalText(trade[field], field);
  if (trade.status === "CLOSED" && !trade.closedAt) throw new SyncValidationError("Closed trade must include closedAt.");
  if (trade.status !== "CLOSED" && trade.closedAt) throw new SyncValidationError("Only closed trades may include closedAt.");
  if (trade.status !== "CLOSED" && trade.outcome !== "UNRESOLVED") throw new SyncValidationError("Only closed trades may have a resolved outcome.");
  if (trade.openedAt && trade.closedAt && Date.parse(trade.closedAt) < Date.parse(trade.openedAt)) {
    throw new SyncValidationError("Trade closedAt cannot precede openedAt.");
  }
}

function validateCommonSnapshot(snapshot) {
  requiredUuid(snapshot.userId, "Snapshot userId");
  requiredUuid(snapshot.originDeviceId, "Snapshot originDeviceId");
  requiredUuid(snapshot.lastModifiedByDeviceId, "Snapshot lastModifiedByDeviceId");
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 1) throw new SyncValidationError("Snapshot version is invalid.");
  requiredTimestamp(snapshot.createdAt, "Snapshot createdAt");
  requiredTimestamp(snapshot.updatedAt, "Snapshot updatedAt");
  if (snapshot.deletedAt !== null) requiredTimestamp(snapshot.deletedAt, "Snapshot deletedAt");
}

function requiredUuid(value, label) {
  if (!isUuid(value)) throw new SyncValidationError(`${label} must be a UUID.`);
}

function requiredText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new SyncValidationError(`${label} is required.`);
}

function optionalText(value, label) {
  if (value !== null && value !== undefined && typeof value !== "string") throw new SyncValidationError(`${label} must be text or null.`);
}

function requiredTimestamp(value, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new SyncValidationError(`${label} is invalid.`);
}

function optionalDecimal(value, label) {
  if (value !== null && value !== undefined && (typeof value !== "string" || !DECIMAL_PATTERN.test(value))) {
    throw new SyncValidationError(`${label} is invalid.`);
  }
}

function optionalPositiveDecimal(value, label) {
  optionalDecimal(value, label);
  if (value !== null && value !== undefined && /^0(?:\.0+)?$/.test(value)) throw new SyncValidationError(`${label} must be positive.`);
}

function optionalSafeInteger(value, label) {
  if (value !== null && value !== undefined && !Number.isSafeInteger(value)) throw new SyncValidationError(`${label} is invalid.`);
}

function optionalJson(value, label) {
  if (value === null || value === undefined) return;
  try {
    canonicalJson(value);
  } catch {
    throw new SyncValidationError(`${label} must contain valid JSON.`);
  }
}

export class SyncValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SyncValidationError";
    this.code = "INVALID_SYNC_INPUT";
  }
}
