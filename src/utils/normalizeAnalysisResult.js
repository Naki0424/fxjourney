function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return number > 1 ? number / 100 : Math.max(0, Math.min(1, number));
}

function normalizeCategory(category, source = "ai") {
  const categoryId = category.categoryId || category.id || null;
  return {
    categoryId,
    id: categoryId,
    name: category.name || "Uncategorized",
    confidence: normalizeConfidence(category.confidence),
    source: category.source || source,
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function normalizeTimeframeEvidence(raw = {}) {
  return {
    provided: Array.isArray(raw.provided)
      ? raw.provided
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          timeframe: item.timeframe || null,
          summary: item.summary || null,
        }))
        .filter((item) => item.timeframe && item.summary)
      : [],
    unavailable: normalizeStringArray(raw.unavailable),
    conflicts: normalizeStringArray(raw.conflicts),
    alignmentSummary: raw.alignmentSummary || null,
  };
}

function normalizeAdditionalContextRequested(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && item.timeframe && item.reason)
    .slice(0, 3)
    .map((item) => ({ timeframe: item.timeframe, reason: item.reason }));
}

function normalizeMainTrendAnalysis(raw = {}) {
  return {
    trend: raw.trend || null,
    strength: raw.strength || null,
    confidence: normalizeConfidence(raw.confidence),
    structure: raw.structure || null,
    momentum: raw.momentum || null,
    phase: raw.phase || null,
    keySupport: normalizeStringArray(raw.keySupport),
    keyResistance: normalizeStringArray(raw.keyResistance),
    reasoning: normalizeStringArray(raw.reasoning),
    invalidation: raw.invalidation || null,
    summary: raw.summary || null,
  };
}

function normalizeTradeRecommendation(raw = {}, index) {
  const entry = raw.entry || {};
  const stopLoss = raw.stopLoss || {};
  return {
    id: raw.id || `recommendation-${index + 1}`,
    style: raw.style || "AI_OPPORTUNITY",
    title: raw.title || raw.style || "Trade Recommendation",
    action: raw.action || "NO_TRADE",
    confidence: normalizeConfidence(raw.confidence),
    timeframeContext: raw.timeframeContext || null,
    setupType: raw.setupType || null,
    entry: {
      type: entry.type || null,
      low: entry.low || null,
      high: entry.high || null,
      trigger: entry.trigger || null,
    },
    stopLoss: {
      price: stopLoss.price || null,
      reason: stopLoss.reason || null,
    },
    takeProfits: Array.isArray(raw.takeProfits)
      ? raw.takeProfits.slice(0, 3).map((takeProfit) => ({
          label: takeProfit.label || "Take Profit",
          price: takeProfit.price || null,
          reason: takeProfit.reason || null,
        }))
      : [],
    riskReward: raw.riskReward || null,
    reasons: normalizeStringArray(raw.reasons),
    invalidation: normalizeStringArray(raw.invalidation),
    risks: normalizeStringArray(raw.risks),
    summary: raw.summary || null,
  };
}

/**
 * Converts any provider response into the stable object consumed by the UI.
 * Provider-specific field names must be handled here instead of in JSX.
 */
export function normalizeAnalysisResult(raw = {}) {
  const patternAnalysis = raw.patternAnalysis || {};
  const marketStructure = raw.marketStructure || {};
  const marketContext = raw.marketContext || {};
  const tradeIdea = raw.tradeIdea || {};
  const mainTrendAnalysis = raw.mainTrendAnalysis || {};

  return {
    analysisId: raw.analysisId || `analysis-${Date.now()}`,
    status: raw.status || "completed",
    analysisVersion: raw.analysisVersion || 1,
    modelVersion: raw.modelVersion || "unknown",
    analyzedAt: raw.analyzedAt || new Date().toISOString(),
    confidence: normalizeConfidence(raw.confidence),
    detectedCategories: Array.isArray(raw.detectedCategories)
      ? raw.detectedCategories.map((category) => normalizeCategory(category))
      : [],
    suggestedCategories: Array.isArray(raw.suggestedCategories)
      ? raw.suggestedCategories.map((category) => normalizeCategory(category))
      : [],
    mainTrendAnalysis: normalizeMainTrendAnalysis(mainTrendAnalysis),
    tradeRecommendations: Array.isArray(raw.tradeRecommendations)
      ? raw.tradeRecommendations.map((recommendation, index) => normalizeTradeRecommendation(recommendation, index))
      : [],
    timeframeEvidence: normalizeTimeframeEvidence(raw.timeframeEvidence),
    additionalContextRequested: normalizeAdditionalContextRequested(raw.additionalContextRequested),
    patternAnalysis: {
      primaryPattern: patternAnalysis.primaryPattern || null,
      confidence: normalizeConfidence(patternAnalysis.confidence),
      summary: patternAnalysis.summary || null,
      observations: Array.isArray(patternAnalysis.observations) ? patternAnalysis.observations : [],
    },
    keyLevels: Array.isArray(raw.keyLevels)
      ? raw.keyLevels.map((level) => ({
          id: level.id || `level-${Math.random().toString(36).slice(2)}`,
          type: level.type || "level",
          label: level.label || "Key Level",
          price: level.price || null,
          priceLow: level.priceLow || null,
          priceHigh: level.priceHigh || null,
          confidence: normalizeConfidence(level.confidence),
          annotation: level.annotation || null,
          coordinates: level.coordinates || null,
        }))
      : [],
    marketStructure: {
      bias: marketStructure.bias || null,
      structure: marketStructure.structure || null,
      trend: marketStructure.trend || null,
    },
    marketContext: {
      instrument: marketContext.instrument || null,
      timeframe: marketContext.timeframe || null,
      session: marketContext.session || null,
      trend: marketContext.trend || marketStructure.trend || null,
    },
    tradeIdea: {
      direction: tradeIdea.direction || null,
      entry: tradeIdea.entry || null,
      stopLoss: tradeIdea.stopLoss || null,
      takeProfit: tradeIdea.takeProfit || null,
      riskReward: tradeIdea.riskReward || tradeIdea.rr || null,
    },
    extractedText: Array.isArray(raw.extractedText) ? raw.extractedText : [],
    suggestedTags: Array.isArray(raw.suggestedTags) ? raw.suggestedTags : [],
    insight: raw.insight || null,
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
  };
}
