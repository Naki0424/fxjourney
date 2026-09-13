import { parseJsonColumn, jsonValue } from "../utils.js";

const TRADE_COLUMNS = [
  "accountId",
  "instrument",
  "direction",
  "status",
  "outcome",
  "openedAt",
  "closedAt",
  "entryPrice",
  "exitPrice",
  "stopLossPrice",
  "quantityLots",
  "accountEquityAtEntryMinor",
  "riskAmountMinor",
  "riskPercent",
  "pnlAmountMinor",
  "setupType",
  "emotionBefore",
  "emotionDuring",
  "emotionAfter",
  "notes",
  "rating",
  "planAdherence",
];

function mapTrade(row) {
  if (!row) return null;
  const {
    takeProfitTargetsJson,
    confluenceJson,
    tradePlanJson,
    emotionsJson,
    reviewJson,
    ...trade
  } = row;
  return {
    ...trade,
    takeProfitTargets: parseJsonColumn(takeProfitTargetsJson, "takeProfitTargets"),
    confluence: parseJsonColumn(confluenceJson, "confluence"),
    tradePlan: parseJsonColumn(tradePlanJson, "tradePlan"),
    emotions: parseJsonColumn(emotionsJson, "emotions"),
    review: parseJsonColumn(reviewJson, "review"),
  };
}

function databaseTradeValues(trade) {
  return {
    ...trade,
    takeProfitTargetsJson: jsonValue(trade.takeProfitTargets, "takeProfitTargets"),
    confluenceJson: jsonValue(trade.confluence, "confluence"),
    tradePlanJson: jsonValue(trade.tradePlan, "tradePlan"),
    emotionsJson: jsonValue(trade.emotions, "emotions"),
    reviewJson: jsonValue(trade.review, "review"),
  };
}

export function findTradeById(database, id) {
  return mapTrade(database.prepare("SELECT * FROM trades WHERE id = ?").get(id));
}

export function listTradesByUserId(database, userId, filters = {}) {
  const conditions = ["userId = @userId", "deletedAt IS NULL"];
  const parameters = { userId };
  const filterColumns = ["accountId", "instrument", "direction", "status", "outcome"];

  for (const column of filterColumns) {
    if (filters[column]) {
      conditions.push(`${column} = @${column}`);
      parameters[column] = filters[column];
    }
  }
  if (filters.openedAtFrom) {
    conditions.push("openedAt >= @openedAtFrom");
    parameters.openedAtFrom = filters.openedAtFrom;
  }
  if (filters.openedAtTo) {
    conditions.push("openedAt <= @openedAtTo");
    parameters.openedAtTo = filters.openedAtTo;
  }

  return database.prepare(`
    SELECT * FROM trades
    WHERE ${conditions.join(" AND ")}
    ORDER BY openedAt DESC, createdAt DESC, id DESC
  `).all(parameters).map(mapTrade);
}

export function insertTrade(database, trade) {
  const values = databaseTradeValues(trade);
  database.prepare(`
    INSERT INTO trades (
      id, userId, accountId, instrument, direction, status, outcome,
      openedAt, closedAt, entryPrice, exitPrice, stopLossPrice,
      takeProfitTargetsJson, quantityLots, accountEquityAtEntryMinor,
      riskAmountMinor, riskPercent, pnlAmountMinor, setupType, confluenceJson,
      tradePlanJson, emotionBefore, emotionDuring, emotionAfter, emotionsJson,
      reviewJson, notes, rating, planAdherence, createdAt, updatedAt, deletedAt,
      version, originDeviceId, lastModifiedByDeviceId
    ) VALUES (
      @id, @userId, @accountId, @instrument, @direction, @status, @outcome,
      @openedAt, @closedAt, @entryPrice, @exitPrice, @stopLossPrice,
      @takeProfitTargetsJson, @quantityLots, @accountEquityAtEntryMinor,
      @riskAmountMinor, @riskPercent, @pnlAmountMinor, @setupType, @confluenceJson,
      @tradePlanJson, @emotionBefore, @emotionDuring, @emotionAfter, @emotionsJson,
      @reviewJson, @notes, @rating, @planAdherence, @createdAt, @updatedAt,
      @deletedAt, @version, @originDeviceId, @lastModifiedByDeviceId
    )
  `).run(values);
  return findTradeById(database, trade.id);
}

export function updateTradeByVersion(database, trade, expectedVersion) {
  const values = databaseTradeValues(trade);
  const result = database.prepare(`
    UPDATE trades SET
      accountId = @accountId, instrument = @instrument, direction = @direction,
      status = @status, outcome = @outcome, openedAt = @openedAt,
      closedAt = @closedAt, entryPrice = @entryPrice, exitPrice = @exitPrice,
      stopLossPrice = @stopLossPrice, takeProfitTargetsJson = @takeProfitTargetsJson,
      quantityLots = @quantityLots, accountEquityAtEntryMinor = @accountEquityAtEntryMinor,
      riskAmountMinor = @riskAmountMinor, riskPercent = @riskPercent,
      pnlAmountMinor = @pnlAmountMinor, setupType = @setupType,
      confluenceJson = @confluenceJson, tradePlanJson = @tradePlanJson,
      emotionBefore = @emotionBefore, emotionDuring = @emotionDuring,
      emotionAfter = @emotionAfter, emotionsJson = @emotionsJson,
      reviewJson = @reviewJson, notes = @notes, rating = @rating,
      planAdherence = @planAdherence, updatedAt = @updatedAt,
      version = version + 1, lastModifiedByDeviceId = @lastModifiedByDeviceId
    WHERE id = @id AND userId = @userId AND version = @expectedVersion AND deletedAt IS NULL
  `).run({ ...values, expectedVersion });
  return result.changes === 1 ? findTradeById(database, trade.id) : null;
}

export function softDeleteTradeByVersion(database, { id, userId, deletedAt, updatedAt, deviceId }, expectedVersion) {
  const result = database.prepare(`
    UPDATE trades SET
      deletedAt = ?, updatedAt = ?, version = version + 1,
      lastModifiedByDeviceId = ?
    WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL
  `).run(deletedAt, updatedAt, deviceId, id, userId, expectedVersion);
  return result.changes === 1 ? findTradeById(database, id) : null;
}
