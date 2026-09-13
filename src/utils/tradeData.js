const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const MONEY_SYMBOLS = {
  AUD: "$",
  CAD: "$",
  CHF: "CHF ",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  NZD: "$",
  USD: "$",
};

const OUTCOME_LABELS = {
  BREAKEVEN: "Breakeven",
  LOSS: "Loss",
  UNRESOLVED: "Unresolved",
  WIN: "Win",
};

export function isCanonicalDecimal(value, { positive = false } = {}) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value.trim())) return false;
  return !positive || !/^0(?:\.0+)?$/.test(value.trim());
}

export function localDateTimeToUtc(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function utcToLocalDateTime(value) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export function formatMoneyMinor(value, currencyCode = "USD", minorDigits = 2, { signed = false } = {}) {
  if (value === undefined || value === null || value === "") return "N/A";
  const integerValue = typeof value === "bigint"
    ? value.toString()
    : typeof value === "number"
      ? Number.isSafeInteger(value) ? String(value) : null
      : typeof value === "string" && /^-?\d+$/.test(value.trim()) ? value.trim() : null;
  if (!integerValue) return "N/A";

  const digits = Number.isInteger(minorDigits) && minorDigits >= 0 ? minorDigits : 2;
  const amount = BigInt(integerValue);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = 10n ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = digits ? String(absolute % scale).padStart(digits, "0") : "";
  const groupedWhole = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const code = String(currencyCode || "USD").toUpperCase();
  const symbol = MONEY_SYMBOLS[code] || `${code} `;
  const sign = negative ? "-" : signed && amount > 0n ? "+" : "";
  return `${sign}${symbol}${groupedWhole}${digits ? `.${fraction}` : ""}`;
}

export function decimalStringToMinorUnits(value, minorDigits = 2) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Money must be entered as a decimal amount.");
  }

  const digits = Number.isInteger(minorDigits) && minorDigits >= 0 ? minorDigits : 2;
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart, fractionPart = ""] = unsigned.split(".");
  if (fractionPart.length > digits && /[^0]/.test(fractionPart.slice(digits))) {
    throw new Error(`Money supports at most ${digits} decimal places for this account.`);
  }
  const fraction = fractionPart.slice(0, digits).padEnd(digits, "0");
  const minor = BigInt(wholePart) * (10n ** BigInt(digits)) + BigInt(fraction || "0");
  const signedMinor = negative ? -minor : minor;
  if (signedMinor > BigInt(Number.MAX_SAFE_INTEGER) || signedMinor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error("Money amount is too large.");
  }
  return signedMinor.toString();
}

export function takeProfitPrice(trade) {
  const target = Array.isArray(trade?.takeProfitTargets) ? trade.takeProfitTargets[0] : null;
  if (typeof target === "string") return target;
  return target?.price || target?.value || "";
}

export function plannedRiskReward(trade) {
  const entry = Number(trade?.entryPrice);
  const stop = Number(trade?.stopLossPrice);
  const target = Number(takeProfitPrice(trade));
  if (![entry, stop, target].every(Number.isFinite)) return null;
  const risk = trade.direction === "SELL" ? stop - entry : entry - stop;
  const reward = trade.direction === "SELL" ? entry - target : target - entry;
  if (risk <= 0 || reward < 0) return null;
  return reward / risk;
}

export function durationMinutes(openedAt, closedAt) {
  if (!openedAt || !closedAt) return null;
  const minutes = Math.round((Date.parse(closedAt) - Date.parse(openedAt)) / 60000);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function formatDuration(openedAt, closedAt) {
  const minutes = durationMinutes(openedAt, closedAt);
  if (minutes === null) return "N/A";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder}m`;
  return `${hours}h${remainder ? ` ${remainder}m` : ""}`;
}

export function displayOutcome(outcome) {
  return OUTCOME_LABELS[outcome] || (outcome ? String(outcome) : "Unresolved");
}

export function displayStatus(status) {
  if (status === "CLOSED") return "Closed";
  if (status === "OPEN") return "Open";
  if (status === "CANCELLED") return "Cancelled";
  return "Draft";
}

export function displayDirection(direction) {
  return direction === "SELL" ? "Sell" : direction === "BUY" ? "Buy" : "—";
}

export function outcomeTone(outcome) {
  if (outcome === "WIN") return "green";
  if (outcome === "LOSS") return "red";
  return "gray";
}

export function tradeToForm(trade) {
  const confluence = trade?.confluence && typeof trade.confluence === "object" ? trade.confluence : {};
  const plan = trade?.tradePlan && typeof trade.tradePlan === "object" ? trade.tradePlan : {};
  const emotions = trade?.emotions && typeof trade.emotions === "object" ? trade.emotions : {};
  const review = trade?.review && typeof trade.review === "object" ? trade.review : {};
  const outcome = trade?.outcome === "LOSS"
    ? "Loss"
    : trade?.outcome === "BREAKEVEN"
      ? "Breakeven"
      : trade?.outcome === "UNRESOLVED" ? "Unresolved" : "Win";

  return {
    pair: trade?.instrument || "",
    direction: trade?.direction === "SELL" ? "SHORT" : "LONG",
    lots: trade?.quantityLots || "",
    dateTime: utcToLocalDateTime(trade?.openedAt),
    session: confluence.session || "",
    timeframe: confluence.timeframe || "",
    account: trade?.accountId || "",
    status: outcome,
    recordStatus: trade?.status || "DRAFT",
    closedAt: utcToLocalDateTime(trade?.closedAt),
    setup: trade?.setupType || "",
    market: confluence.marketCondition || "",
    tags: [],
    bias: plan.bias || "",
    entryType: "Market Order",
    entry: trade?.entryPrice || "",
    stopLoss: trade?.stopLossPrice || "",
    takeProfit: takeProfitPrice(trade),
    exitPrice: trade?.exitPrice || "",
    riskPips: "",
    rewardPips: "",
    positionSize: trade?.quantityLots || "",
    riskPercent: trade?.riskPercent || "",
    duration: formatDuration(trade?.openedAt, trade?.closedAt),
    tradeReason: plan.reason || "",
    expected: plan.expected || "",
    invalidation: plan.invalidation || "",
    emotionBefore: trade?.emotionBefore || emotions.before || "",
    emotionDuring: trade?.emotionDuring || emotions.during || "",
    emotionAfter: trade?.emotionAfter || emotions.after || "",
    emotionBeforeNote: emotions.beforeNote || "",
    emotionDuringNote: emotions.duringNote || "",
    emotionAfterNote: emotions.afterNote || "",
    notes: trade?.notes || "",
    lessonsLearned: review.lessonsLearned || "",
    improvements: review.improvements || "",
    rating: Number.isInteger(trade?.rating) ? trade.rating : 0,
    version: trade?.version,
  };
}

export function formToTradePayload(trade, accountId, { draft = false } = {}) {
  const openedAt = localDateTimeToUtc(trade.dateTime);
  const closedAt = draft ? null : localDateTimeToUtc(trade.closedAt || trade.dateTime);
  const status = draft ? "DRAFT" : "CLOSED";
  const outcome = draft
    ? "UNRESOLVED"
    : trade.status === "Loss" ? "LOSS" : trade.status === "Breakeven" ? "BREAKEVEN" : trade.status === "Unresolved" ? "UNRESOLVED" : "WIN";
  const takeProfit = trade.takeProfit?.trim();

  return {
    accountId,
    instrument: trade.pair.trim(),
    direction: trade.direction === "SHORT" ? "SELL" : "BUY",
    status,
    outcome,
    openedAt,
    closedAt,
    entryPrice: trade.entry.trim() || null,
    exitPrice: status === "CLOSED" ? trade.exitPrice.trim() || null : null,
    stopLossPrice: trade.stopLoss.trim() || null,
    takeProfitTargets: takeProfit ? [{ label: "TP1", price: takeProfit }] : null,
    quantityLots: trade.lots.trim() || trade.positionSize.trim() || null,
    accountEquityAtEntryMinor: null,
    riskAmountMinor: null,
    riskPercent: trade.riskPercent.trim() || null,
    pnlAmountMinor: null,
    setupType: trade.setup.trim() || null,
    confluence: {
      marketCondition: trade.market,
      session: trade.session,
      timeframe: trade.timeframe,
    },
    tradePlan: {
      bias: trade.bias,
      reason: trade.tradeReason,
      expected: trade.expected,
      invalidation: trade.invalidation,
    },
    emotionBefore: trade.emotionBefore || null,
    emotionDuring: trade.emotionDuring || null,
    emotionAfter: trade.emotionAfter || null,
    emotions: {
      before: trade.emotionBefore,
      during: trade.emotionDuring,
      after: trade.emotionAfter,
      beforeNote: trade.emotionBeforeNote,
      duringNote: trade.emotionDuringNote,
      afterNote: trade.emotionAfterNote,
    },
    review: {
      lessonsLearned: trade.lessonsLearned,
      improvements: trade.improvements,
    },
    notes: trade.notes.trim() || null,
    rating: trade.rating || null,
    planAdherence: "NOT_RATED",
  };
}

export function validateTradeForm(trade, accountId) {
  if (!accountId) return "Select an active account before saving the trade.";
  if (!trade.pair.trim()) return "Currency pair is required.";
  if (!trade.dateTime || !localDateTimeToUtc(trade.dateTime)) return "Enter a valid trade date and time.";
  if (!isCanonicalDecimal(trade.positionSize.trim() || trade.lots.trim(), { positive: true })) {
    return "Lots must be a positive canonical decimal value.";
  }
  for (const [label, value] of [["Entry Price", trade.entry], ["Stop Loss", trade.stopLoss], ["Take Profit", trade.takeProfit], ["Exit Price", trade.exitPrice]]) {
    if (value.trim() && !isCanonicalDecimal(value.trim())) return `${label} must be a canonical decimal value.`;
  }
  if (trade.riskPercent.trim() && !isCanonicalDecimal(trade.riskPercent.trim())) return "Risk percentage must be a canonical decimal value.";
  return null;
}

export function toTradeViewModel(trade, account) {
  const currencyCode = account?.currencyCode || "USD";
  const minorDigits = account?.currencyMinorDigits ?? 2;
  const rr = plannedRiskReward(trade);
  const confluence = trade?.confluence && typeof trade.confluence === "object" ? trade.confluence : {};
  const plan = trade?.tradePlan && typeof trade.tradePlan === "object" ? trade.tradePlan : {};
  const review = trade?.review && typeof trade.review === "object" ? trade.review : {};
  return {
    ...trade,
    pair: trade.instrument,
    pairName: trade.instrument,
    type: displayDirection(trade.direction),
    lots: trade.quantityLots || "N/A",
    entry: trade.entryPrice || "N/A",
    exit: trade.exitPrice || "N/A",
    pnl: formatMoneyMinor(trade.pnlAmountMinor, currencyCode, minorDigits, { signed: true }),
    pnlPercent: "N/A",
    rr: rr === null ? "N/A" : `${rr.toFixed(2)}R`,
    duration: formatDuration(trade.openedAt, trade.closedAt),
    status: displayStatus(trade.status),
    outcome: displayOutcome(trade.outcome),
    session: confluence.session || "N/A",
    setup: trade.setupType || "N/A",
    bias: plan.bias || "N/A",
    timeframe: confluence.timeframe || "N/A",
    market: confluence.marketCondition || "N/A",
    confluence: Object.values(confluence).filter(Boolean).join(", ") || "N/A",
    tags: [],
    attachments: [],
    openedLabel: formatDateTime(trade.openedAt),
    closedLabel: formatDateTime(trade.closedAt),
    riskAmount: formatMoneyMinor(trade.riskAmountMinor, currencyCode, minorDigits),
    planReason: plan.reason || "N/A",
    expected: plan.expected || "N/A",
    invalidation: plan.invalidation || "N/A",
    lessonsLearned: review.lessonsLearned || "N/A",
    improvements: review.improvements || "N/A",
  };
}
