import { Type } from "@google/genai";

const stringField = () => ({ type: Type.STRING });
const confidenceField = () => ({ type: Type.NUMBER, minimum: 0, maximum: 1 });
const enumField = (values) => ({ type: Type.STRING, enum: values });
const stringArrayField = (minItems) => ({
  type: Type.ARRAY,
  ...(minItems ? { minItems } : {}),
  items: stringField(),
});

const trendValues = ["BULLISH", "BEARISH", "SIDEWAYS", "TRANSITIONAL", "UNCLEAR"];
const strengthValues = ["WEAK", "MODERATE", "STRONG"];
const styleValues = ["SCALP", "INTRADAY", "SWING", "AI_OPPORTUNITY"];
const actionValues = ["BUY", "SELL", "WAIT", "NO_TRADE"];

const categoryField = () => ({
  type: Type.OBJECT,
  required: ["categoryId", "name", "confidence"],
  properties: {
    categoryId: stringField(),
    name: stringField(),
    confidence: confidenceField(),
  },
});

const mainTrendAnalysisField = () => ({
  type: Type.OBJECT,
  required: [
    "trend",
    "strength",
    "confidence",
    "structure",
    "momentum",
    "phase",
    "keySupport",
    "keyResistance",
    "reasoning",
    "invalidation",
    "summary",
  ],
  properties: {
    trend: enumField(trendValues),
    strength: enumField(strengthValues),
    confidence: confidenceField(),
    structure: stringField(),
    momentum: stringField(),
    phase: stringField(),
    keySupport: stringArrayField(),
    keyResistance: stringArrayField(),
    reasoning: stringArrayField(3),
    invalidation: stringField(),
    summary: stringField(),
  },
});

const entryField = () => ({
  type: Type.OBJECT,
  required: ["type", "low", "high", "trigger"],
  properties: {
    type: stringField(),
    low: stringField(),
    high: stringField(),
    trigger: stringField(),
  },
});

const stopLossField = () => ({
  type: Type.OBJECT,
  required: ["price", "reason"],
  properties: {
    price: stringField(),
    reason: stringField(),
  },
});

const takeProfitField = () => ({
  type: Type.OBJECT,
  required: ["label", "price", "reason"],
  properties: {
    label: stringField(),
    price: stringField(),
    reason: stringField(),
  },
});

const tradeRecommendationField = () => ({
  type: Type.OBJECT,
  required: [
    "id",
    "style",
    "title",
    "action",
    "confidence",
    "timeframeContext",
    "setupType",
    "entry",
    "stopLoss",
    "takeProfits",
    "riskReward",
    "reasons",
    "invalidation",
    "risks",
    "summary",
  ],
  properties: {
    id: stringField(),
    style: enumField(styleValues),
    title: stringField(),
    action: enumField(actionValues),
    confidence: confidenceField(),
    timeframeContext: stringField(),
    setupType: stringField(),
    entry: entryField(),
    stopLoss: stopLossField(),
    takeProfits: {
      type: Type.ARRAY,
      // Gemini rejects the combined Analyzer schema when this nested limit is sent.
      // server/index.js still enforces the maximum of three targets after generation.
      items: takeProfitField(),
    },
    riskReward: stringField(),
    reasons: stringArrayField(3),
    invalidation: stringArrayField(1),
    risks: stringArrayField(1),
    summary: stringField(),
  },
});

const timeframeEvidenceField = () => ({
  type: Type.OBJECT,
  required: ["provided", "unavailable", "conflicts", "alignmentSummary"],
  properties: {
    provided: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["timeframe", "summary"],
        properties: {
          timeframe: stringField(),
          summary: stringField(),
        },
      },
    },
    unavailable: stringArrayField(),
    conflicts: stringArrayField(),
    alignmentSummary: stringField(),
  },
});

const additionalContextRequestField = () => ({
  type: Type.OBJECT,
  required: ["timeframe", "reason"],
  properties: {
    timeframe: stringField(),
    reason: stringField(),
  },
});

export const analysisResponseSchema = {
  type: Type.OBJECT,
  required: [
    "confidence",
    "detectedCategories",
    "suggestedCategories",
    "suggestedTags",
    "mainTrendAnalysis",
    "tradeRecommendations",
    "timeframeEvidence",
    "additionalContextRequested",
    "patternAnalysis",
    "keyLevels",
    "marketContext",
    "marketStructure",
    "tradeIdea",
    "insight",
    "warnings",
    "modelVersion",
    "analysisVersion",
    "analyzedAt",
  ],
  properties: {
    confidence: confidenceField(),
    detectedCategories: {
      type: Type.ARRAY,
      items: categoryField(),
    },
    suggestedCategories: {
      type: Type.ARRAY,
      items: categoryField(),
    },
    suggestedTags: {
      type: Type.ARRAY,
      items: stringField(),
    },
    mainTrendAnalysis: mainTrendAnalysisField(),
    tradeRecommendations: {
      type: Type.ARRAY,
      minItems: 3,
      maxItems: 5,
      items: tradeRecommendationField(),
    },
    timeframeEvidence: timeframeEvidenceField(),
    additionalContextRequested: {
      type: Type.ARRAY,
      maxItems: 3,
      items: additionalContextRequestField(),
    },
    patternAnalysis: {
      type: Type.OBJECT,
      required: ["primaryPattern", "confidence", "summary", "observations"],
      properties: {
        primaryPattern: stringField(),
        confidence: confidenceField(),
        summary: stringField(),
        observations: {
          type: Type.ARRAY,
          items: stringField(),
        },
      },
    },
    keyLevels: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        required: ["id", "type", "label", "price", "priceLow", "priceHigh"],
        properties: {
          id: stringField(),
          type: stringField(),
          label: stringField(),
          price: stringField(),
          priceLow: stringField(),
          priceHigh: stringField(),
        },
      },
    },
    marketContext: {
      type: Type.OBJECT,
      required: ["trend", "timeframe", "instrument", "session"],
      properties: {
        trend: stringField(),
        timeframe: stringField(),
        instrument: stringField(),
        session: stringField(),
      },
    },
    marketStructure: {
      type: Type.OBJECT,
      required: ["trend", "bias", "structure"],
      properties: {
        trend: stringField(),
        bias: stringField(),
        structure: stringField(),
      },
    },
    tradeIdea: {
      type: Type.OBJECT,
      required: ["direction", "entry", "stopLoss", "takeProfit", "riskReward"],
      properties: {
        direction: stringField(),
        entry: stringField(),
        stopLoss: stringField(),
        takeProfit: stringField(),
        riskReward: stringField(),
      },
    },
    insight: stringField(),
    warnings: {
      type: Type.ARRAY,
      items: stringField(),
    },
    modelVersion: stringField(),
    analysisVersion: stringField(),
    analyzedAt: stringField(),
  },
};
