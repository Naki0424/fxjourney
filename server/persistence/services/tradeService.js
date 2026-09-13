import { findAccountById } from "../repositories/accountRepository.js";
import { findTradeById, insertTrade, listTradesByUserId, softDeleteTradeByVersion, updateTradeByVersion } from "../repositories/tradeRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, createId, decimalString, enumValue, integerValue, jsonValue, nowUtc, optionalText, parsePositiveVersion, requiredText, timestampValue, withTransaction } from "../utils.js";

const DIRECTIONS = new Set(["BUY", "SELL"]);
const STATUSES = new Set(["DRAFT", "OPEN", "CLOSED", "CANCELLED"]);
const OUTCOMES = new Set(["WIN", "LOSS", "BREAKEVEN", "UNRESOLVED"]);
const PLAN_ADHERENCE = new Set(["FOLLOWED", "PARTIAL", "BROKE_PLAN", "NOT_RATED"]);

export function createTradeService({ database, getContext }) {
  function context() {
    return getContext();
  }

  function ownedTrade(id) {
    const trade = findTradeById(database, id);
    if (!trade || trade.userId !== context().userId || trade.deletedAt) {
      throw notFound("Trade not found.");
    }
    return trade;
  }

  function validateAccount(accountId) {
    const account = findAccountById(database, accountId);
    if (!account || account.userId !== context().userId || !account.active || account.deletedAt) {
      throw notFound("Account not found or inactive.");
    }
    return account;
  }

  function normalizeTradeFields(source, { create = false } = {}) {
    const fields = {
      accountId: requiredText(source.accountId, "accountId"),
      instrument: requiredText(source.instrument, "instrument", { maxLength: 100 }),
      direction: enumValue(source.direction, "direction", DIRECTIONS),
      status: enumValue(source.status, "status", STATUSES, { defaultValue: create ? "DRAFT" : undefined }),
      outcome: enumValue(source.outcome, "outcome", OUTCOMES, { defaultValue: "UNRESOLVED" }),
      openedAt: timestampValue(source.openedAt, "openedAt"),
      closedAt: timestampValue(source.closedAt, "closedAt"),
      entryPrice: decimalString(source.entryPrice, "entryPrice"),
      exitPrice: decimalString(source.exitPrice, "exitPrice"),
      stopLossPrice: decimalString(source.stopLossPrice, "stopLossPrice"),
      quantityLots: decimalString(source.quantityLots, "quantityLots", { positive: true }),
      accountEquityAtEntryMinor: integerValue(source.accountEquityAtEntryMinor, "accountEquityAtEntryMinor"),
      riskAmountMinor: integerValue(source.riskAmountMinor, "riskAmountMinor"),
      riskPercent: decimalString(source.riskPercent, "riskPercent"),
      pnlAmountMinor: integerValue(source.pnlAmountMinor, "pnlAmountMinor"),
      setupType: optionalText(source.setupType, "setupType"),
      emotionBefore: optionalText(source.emotionBefore, "emotionBefore"),
      emotionDuring: optionalText(source.emotionDuring, "emotionDuring"),
      emotionAfter: optionalText(source.emotionAfter, "emotionAfter"),
      notes: optionalText(source.notes, "notes", { maxLength: 10000 }),
      rating: integerValue(source.rating, "rating", { min: 1, max: 5 }),
      planAdherence: enumValue(source.planAdherence, "planAdherence", PLAN_ADHERENCE, { defaultValue: "NOT_RATED" }),
      takeProfitTargets: source.takeProfitTargets === undefined ? null : source.takeProfitTargets,
      confluence: source.confluence === undefined ? null : source.confluence,
      tradePlan: source.tradePlan === undefined ? null : source.tradePlan,
      emotions: source.emotions === undefined ? null : source.emotions,
      review: source.review === undefined ? null : source.review,
    };

    for (const [field, value] of Object.entries({
      takeProfitTargets: fields.takeProfitTargets,
      confluence: fields.confluence,
      tradePlan: fields.tradePlan,
      emotions: fields.emotions,
      review: fields.review,
    })) {
      if (value !== null) jsonValue(value, field);
    }

    if (fields.status === "CLOSED" && !fields.closedAt) {
      throw badRequest("CLOSED trades must include closedAt.");
    }
    if (fields.status !== "CLOSED" && fields.closedAt) {
      throw badRequest("Only CLOSED trades may include closedAt.");
    }
    if (fields.status !== "CLOSED" && fields.outcome !== "UNRESOLVED") {
      throw badRequest("Only CLOSED trades may have a resolved outcome.");
    }
    if (fields.openedAt && fields.closedAt && Date.parse(fields.closedAt) < Date.parse(fields.openedAt)) {
      throw badRequest("closedAt cannot precede openedAt.");
    }
    return fields;
  }

  function create(body) {
    const source = assertRequestObject(body);
    const fields = normalizeTradeFields(source, { create: true });
    const localContext = context();
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      validateAccount(fields.accountId);
      return insertTrade(database, {
        id: createId(),
        userId: localContext.userId,
        ...fields,
        createdAt: timestamp,
        updatedAt: timestamp,
        deletedAt: null,
        version: 1,
        originDeviceId: localContext.deviceId,
        lastModifiedByDeviceId: localContext.deviceId,
      });
    });
  }

  function list(filters = {}) {
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) throw badRequest("Trade filters must be an object.");
    const normalizedFilters = { ...filters };
    for (const field of ["direction", "status", "outcome"]) {
      if (normalizedFilters[field]) normalizedFilters[field] = enumValue(normalizedFilters[field], field, field === "direction" ? DIRECTIONS : field === "status" ? STATUSES : OUTCOMES);
    }
    if (normalizedFilters.instrument) normalizedFilters.instrument = requiredText(normalizedFilters.instrument, "instrument", { maxLength: 100 });
    if (normalizedFilters.accountId) normalizedFilters.accountId = requiredText(normalizedFilters.accountId, "accountId");
    normalizedFilters.openedAtFrom = timestampValue(normalizedFilters.openedAtFrom, "openedAtFrom");
    normalizedFilters.openedAtTo = timestampValue(normalizedFilters.openedAtTo, "openedAtTo");
    if (normalizedFilters.openedAtFrom && normalizedFilters.openedAtTo && Date.parse(normalizedFilters.openedAtTo) < Date.parse(normalizedFilters.openedAtFrom)) {
      throw badRequest("openedAtTo cannot precede openedAtFrom.");
    }
    return listTradesByUserId(database, context().userId, normalizedFilters);
  }

  function get(id) {
    return ownedTrade(id);
  }

  function update(id, body, expectedVersion) {
    const source = assertRequestObject(body);
    const current = ownedTrade(id);
    const version = parsePositiveVersion(expectedVersion);
    const fields = normalizeTradeFields({ ...current, ...source });
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      validateAccount(fields.accountId);
      const updated = updateTradeByVersion(database, {
        ...current,
        ...fields,
        updatedAt: timestamp,
        lastModifiedByDeviceId: context().deviceId,
      }, version);
      if (!updated) throw conflict("The trade was changed by another operation.", "STALE_VERSION");
      return updated;
    });
  }

  function remove(id, expectedVersion) {
    const current = ownedTrade(id);
    const version = parsePositiveVersion(expectedVersion);
    const timestamp = nowUtc();
    const deleted = softDeleteTradeByVersion(database, {
      id: current.id,
      userId: current.userId,
      deletedAt: timestamp,
      updatedAt: timestamp,
      deviceId: context().deviceId,
    }, version);
    if (!deleted) throw conflict("The trade was changed by another operation.", "STALE_VERSION");
    return deleted;
  }

  return { create, list, get, update, remove };
}
