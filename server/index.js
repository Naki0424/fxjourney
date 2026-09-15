import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { analysisResponseSchema } from "./analysisSchema.js";
import { openDatabase } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { createPersistenceRouter } from "./persistence/routes.js";
import { bootstrapLocalInstallation } from "./persistence/services/bootstrapService.js";
import { createMediaStorage } from "./persistence/mediaStorage.js";
import { createMediaUploadMiddleware } from "./persistence/mediaUpload.js";

const envPath = fileURLToPath(new URL("./.env", import.meta.url));
dotenv.config({ path: envPath, override: true, quiet: true });
const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || "";
const isDevelopment = process.env.NODE_ENV !== "production";
console.log(`Gemini API key loaded: ${Boolean(geminiApiKey)}`);

const app = express();
const PORT = Number(process.env.PORT || 3001);
const DEFAULT_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const allowedCorsOrigins = new Set([
  ...DEFAULT_CORS_ORIGINS,
  ...(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);
const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const FALLBACK_MODELS = uniqueModels([
  ...parseModelList(process.env.GEMINI_FALLBACK_MODELS),
  ...parseModelList(process.env.GEMINI_FALLBACK_MODEL),
]).filter((model) => model !== MODEL);
const MAX_GEMINI_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const MAX_SCREENSHOTS_PER_ANALYSIS = 10;
const MAIN_TREND_VALUES = new Set(["BULLISH", "BEARISH", "SIDEWAYS", "TRANSITIONAL", "UNCLEAR"]);
const TREND_STRENGTH_VALUES = new Set(["WEAK", "MODERATE", "STRONG"]);
const RECOMMENDATION_STYLE_VALUES = new Set(["SCALP", "INTRADAY", "SWING", "AI_OPPORTUNITY"]);
const RECOMMENDATION_ACTION_VALUES = new Set(["BUY", "SELL", "WAIT", "NO_TRADE"]);
const persistenceDatabase = openDatabase();
runMigrations(persistenceDatabase);
const localPersistenceContext = bootstrapLocalInstallation({ database: persistenceDatabase });
const mediaStorage = createMediaStorage();
const upload = createMediaUploadMiddleware();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedCorsOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin is not allowed by CORS"));
  },
}));
app.use(express.json({ limit: "1mb" }));
app.use("/api", createPersistenceRouter({
  database: persistenceDatabase,
  getContext: () => localPersistenceContext,
  mediaStorage,
  uploadMiddleware: upload,
}));

app.get("/api/health", (request, response) => {
  response.json({ ok: true, model: MODEL });
});

const CHART_ANALYSIS_PROMPT = `You are the chart-analysis engine for FXJourney.

Analyze all supplied trading-chart screenshots together and return ONLY JSON matching the provided response schema. This may be an initial analysis or a continuation update. The supplied screenshot metadata identifies the exact timeframe for each image; treat each image as evidence for that timeframe only and never claim that an unavailable timeframe was reviewed.

Use only information that is visibly present in the image or is justifiably inferable from visible chart structure. Never fabricate prices, an instrument/pair, timeframe, session, indicators, or trade certainty. If a value is not visible or cannot be responsibly inferred, return an empty string for that field and explain uncertainty in warnings when useful.

Categories must be reusable analytical classifications, such as chart pattern, trend reversal, support zone, resistance zone, major level, or market structure. Do not use a pair, timeframe, session, or generic directional bias as a category. Put visible or cautiously inferred context such as EURUSD, 15m, London Session, or Bearish in suggestedTags only when justified by the image or supplied context.

Confidence values must be numbers from 0 to 1 and should reflect the visible evidence. Categories may be empty. Key levels may be empty; use string values for prices and leave unknown price fields empty. The tradeIdea is an educational chart observation only, not financial advice. If the image does not support an actionable idea, use empty strings and add a warning. Include a warning that chart observations should be verified manually before trading.

First analyze the overall trend, trend strength, market phase, momentum, market structure, BOS, CHoCH, support and resistance, liquidity, chart patterns, and key levels across the supplied evidence. Put the current high-level conclusion in mainTrendAnalysis. Use only the allowed uppercase trend and strength values. Include at least three concrete reasoning items, and explain what would weaken or invalidate the thesis. keySupport and keyResistance may be empty; never invent their prices.

Populate timeframeEvidence with one provided item for every supplied screenshot timeframe, using a short evidence-based summary for each. Put genuinely unavailable requested context in unavailable, material disagreement between supplied timeframes in conflicts, and summarize their relationship in alignmentSummary. Populate additionalContextRequested with zero to three actionable requests only when another timeframe or specific context would materially improve confidence. Never request a timeframe already supplied.

If frontend context includes previousAnalysis, treat it as the prior validated report, not as visual evidence. Re-evaluate every supplied image and preserve prior conclusions only when the new evidence supports them. Explain meaningful revisions through the new evidence, conflicts, and recommendation contents. A recommendation's timeframeContext must respect its requested horizon: do not use lower-timeframe evidence as proof of a higher-timeframe trend, and allow SWING to be WAIT or NO_TRADE when higher-timeframe evidence is unavailable. Confirmation triggers must describe observable market events or conditions, not broker/order instructions.

Then derive exactly three to five trade recommendations in tradeRecommendations. The first three entries must be SCALP, INTRADAY, and SWING in that order. They are decisions, not promises of active trades, and may be WAIT or NO_TRADE. Add at most two AI_OPPORTUNITY entries only for genuinely distinct visible setups; do not add filler. Use BUY or SELL only when the chart provides clear technical evidence. Every recommendation needs at least three reasons, invalidation conditions, risks or conflicting evidence, and a short summary. Explain the stop-loss reason and the technical meaning of every populated take-profit target. Leave price fields empty when the screenshot does not support a confident level. Only populate riskReward when entry, stop loss, and target data make it reasonably calculable. Prefer WAIT when confirmation is pending and NO_TRADE when the chart is unclear or risk/reward is poor.

The frontend context is a hint only, never visual proof. Do not repeat it as fact when the image contradicts it. Use analysisVersion as the string "1" and analyzedAt as the current ISO-8601 timestamp. Set modelVersion to the model name used for this response.`;

app.post("/api/analyze-chart", upload.array("images", MAX_SCREENSHOTS_PER_ANALYSIS), async (request, response, next) => {
  try {
    if (!request.files?.length) {
      response.status(400).json({ error: "At least one uploaded screenshot is required." });
      return;
    }

    if (!geminiApiKey) {
      response.status(503).json({
        error: "Gemini API key is not configured. Add GEMINI_API_KEY to server/.env and restart the backend.",
      });
      return;
    }

    let context = {};
    try {
      context = JSON.parse(request.body.context || "{}");
    } catch {
      response.status(400).json({ error: "Analyzer context must be valid JSON." });
      return;
    }

    if (!context || typeof context !== "object" || Array.isArray(context)) {
      response.status(400).json({ error: "Analyzer context must be a JSON object." });
      return;
    }

    let screenshotMetadata;
    try {
      screenshotMetadata = JSON.parse(request.body.screenshotMeta || "[]");
    } catch {
      response.status(400).json({ error: "Screenshot metadata must be valid JSON." });
      return;
    }

    if (!Array.isArray(screenshotMetadata) || screenshotMetadata.length !== request.files.length || screenshotMetadata.some((item) => !item || typeof item !== "object" || typeof item.timeframe !== "string" || !item.timeframe.trim())) {
      response.status(400).json({ error: "Every uploaded screenshot must have a timeframe." });
      return;
    }

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const { responseFromGemini, model } = await generateWithFallback({
      ai,
      screenshots: request.files,
      screenshotMetadata,
      context,
    });

    const analysis = parseAnalysisResponse(responseFromGemini.text, screenshotMetadata);
    analysis.modelVersion = model;
    applyDeterministicRiskReward(analysis);
    developmentLog("Final validated server response", analysis);
    response.json(analysis);
  } catch (error) {
    next(error);
  }
});

async function generateWithFallback({ ai, screenshots, screenshotMetadata, context }) {
  const models = [MODEL, ...FALLBACK_MODELS];
  const requestContents = screenshots.flatMap((screenshot, index) => {
    const metadata = screenshotMetadata[index];
    const mimeType = screenshot.mimetype.toLowerCase() === "image/jpg"
      ? "image/jpeg"
      : screenshot.mimetype.toLowerCase();
    return [
      { text: `The next image is the ${metadata.timeframe} chart screenshot. Treat it as evidence for ${metadata.timeframe} only.` },
      {
        inlineData: {
          mimeType,
          data: screenshot.buffer.toString("base64"),
        },
      },
    ];
  });
  requestContents.push({
    text: `${CHART_ANALYSIS_PROMPT}\n\nSupplied screenshot metadata: ${JSON.stringify(screenshotMetadata)}\n\nFrontend context: ${JSON.stringify(context)}`,
  });
  let lastError;
  const modelErrors = [];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    developmentLog("Attempting model", model);
    try {
      const responseFromGemini = await generateWithRetries(ai, {
        model,
        contents: requestContents,
      });
      developmentLog("Analysis succeeded", model);
      return { responseFromGemini, model };
    } catch (error) {
      logGeminiError(model, error, requestContents);
      lastError = error;
      modelErrors.push(error);
      const fallbackAvailable = modelIndex < models.length - 1;
      if (!fallbackAvailable || !isFallbackEligibleGeminiError(error)) {
        throw error;
      }
      const nextModel = models[modelIndex + 1];
      if (isQuotaOrRateLimitError(error)) {
        developmentLog("Model returned quota/rate limit; trying fallback", { model, nextModel });
      } else {
        developmentLog("Model remained temporarily unavailable; trying fallback", { model, nextModel });
      }
    }
  }

  if (modelErrors.length && modelErrors.every(isQuotaOrRateLimitError)) {
    const error = new Error("Gemini quota or rate limit reached. Try again later.");
    error.statusCode = 429;
    throw error;
  }
  throw lastError;
}

async function generateWithRetries(ai, { model, contents }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ai.models.generateContent({
        model,
        contents,
        config: {
          responseMimeType: "application/json",
          responseSchema: analysisResponseSchema,
          temperature: 0.2,
        },
      });
    } catch (error) {
      if (isQuotaOrRateLimitError(error) || !isTransientGeminiError(error) || attempt >= MAX_GEMINI_RETRIES) {
        throw error;
      }

      const retryNumber = attempt + 1;
      const delayMs = RETRY_BASE_DELAY_MS * (2 ** attempt);
      developmentLog("Temporary model failure; retrying", { model, retryNumber, maxRetries: MAX_GEMINI_RETRIES, delayMs });
      await wait(delayMs);
    }
  }
}

function parseModelList(value) {
  return String(value || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

function uniqueModels(models) {
  return [...new Set(models)];
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseAnalysisResponse(text, screenshotMetadata) {
  const cleaned = String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/```$/, "")
    .trim();
  let result;
  try {
    result = JSON.parse(cleaned);
  } catch {
    const error = new Error("Gemini returned invalid structured JSON.");
    error.statusCode = 502;
    throw error;
  }
  developmentLog("Raw parsed Gemini JSON", result);
  validateAnalysisResponse(result, screenshotMetadata);
  return result;
}

function developmentLog(label, value) {
  if (isDevelopment) {
    console.debug(`[analyzer][dev] ${label}`, value);
  }
}

function logGeminiError(model, error, contents) {
  const providerError = getProviderError(error);
  const details = providerError.details || error?.details || null;
  const fieldViolations = [
    ...(Array.isArray(providerError.fieldViolations) ? providerError.fieldViolations : []),
    ...(Array.isArray(providerError.details)
      ? providerError.details.flatMap((detail) => Array.isArray(detail?.fieldViolations) ? detail.fieldViolations : [])
      : []),
  ].map((violation) => ({
    field: violation?.field || violation?.fieldPath || null,
    description: violation?.description || violation?.message || null,
  }));

  developmentLog("Gemini request failure", {
    model,
    httpStatus: getErrorStatus(error),
    providerStatus: providerError.status || providerError.code || null,
    providerMessage: providerError.message || getErrorMessage(error),
    fieldViolations,
    details: redactSensitiveValue(details),
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: true,
      temperature: 0.2,
      thinking: false,
      maxOutputTokens: null,
    },
    imageParts: Array.isArray(contents) ? contents.filter((part) => part?.inlineData).length : 0,
    contentPartCount: Array.isArray(contents) ? contents.length : null,
  });
}

function getProviderError(error) {
  const directProviderError = error?.error || error?.response?.data?.error || error?.response?.data;
  if (directProviderError && typeof directProviderError === "object") return directProviderError;
  try {
    const parsedMessage = JSON.parse(String(error?.message || ""));
    return parsedMessage?.error && typeof parsedMessage.error === "object" ? parsedMessage.error : {};
  } catch {
    return {};
  }
}

function getErrorStatus(error) {
  const providerError = getProviderError(error);
  return Number(error?.status || error?.statusCode || error?.response?.status || providerError.code) || null;
}

function getErrorMessage(error) {
  const providerError = getProviderError(error);
  return String(providerError.message || error?.message || "");
}

function redactSensitiveValue(value) {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /api.?key|authorization|bearer|base64|inlineData/i.test(key) ? "[redacted]" : redactSensitiveValue(item),
    ]));
  }
  if (typeof value === "string" && /AIza|api.?key|authorization|bearer|data:image|base64/i.test(value)) return "[redacted]";
  return value;
}

function validateAnalysisResponse(result, screenshotMetadata = []) {
  const requiredFields = [
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
  ];
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Gemini returned an invalid structured response.");
  }
  if (requiredFields.some((field) => !Object.prototype.hasOwnProperty.call(result, field))) {
    throw new Error("Gemini returned an incomplete structured response.");
  }
  if (!isConfidence(result.confidence)) {
    throw new Error("Gemini returned an invalid confidence value.");
  }
  for (const field of ["detectedCategories", "suggestedCategories", "suggestedTags", "keyLevels", "warnings"]) {
    if (!Array.isArray(result[field])) {
      throw new Error(`Gemini returned an invalid ${field} value.`);
    }
  }
  for (const category of [...result.detectedCategories, ...result.suggestedCategories]) {
    if (!category || typeof category !== "object" || typeof category.categoryId !== "string" || typeof category.name !== "string" || !isConfidence(category.confidence)) {
      throw new Error("Gemini returned an invalid category.");
    }
  }
  for (const level of result.keyLevels) {
    if (!level || typeof level !== "object" || ["id", "type", "label", "price", "priceLow", "priceHigh"].some((field) => typeof level[field] !== "string")) {
      throw new Error("Gemini returned an invalid key level.");
    }
  }
  validateMainTrendAnalysis(result.mainTrendAnalysis);
  validateTradeRecommendations(result.tradeRecommendations);
  validateTimeframeEvidence(result.timeframeEvidence, screenshotMetadata);
  validateAdditionalContextRequested(result.additionalContextRequested, screenshotMetadata);
  for (const field of ["patternAnalysis", "marketContext", "marketStructure", "tradeIdea"]) {
    if (!result[field] || typeof result[field] !== "object" || Array.isArray(result[field])) {
      throw new Error(`Gemini returned an invalid ${field} value.`);
    }
  }
  if (typeof result.patternAnalysis.primaryPattern !== "string" || typeof result.patternAnalysis.summary !== "string" || !Array.isArray(result.patternAnalysis.observations) || result.patternAnalysis.observations.some((observation) => typeof observation !== "string") || !isConfidence(result.patternAnalysis.confidence)) {
    throw new Error("Gemini returned an invalid pattern analysis.");
  }
  for (const field of ["trend", "timeframe", "instrument", "session"]) {
    if (typeof result.marketContext[field] !== "string") {
      throw new Error("Gemini returned invalid market context fields.");
    }
  }
  for (const field of ["trend", "bias", "structure"]) {
    if (typeof result.marketStructure[field] !== "string") {
      throw new Error("Gemini returned invalid market structure fields.");
    }
  }
  for (const field of ["direction", "entry", "stopLoss", "takeProfit", "riskReward"]) {
    if (typeof result.tradeIdea[field] !== "string") {
      throw new Error("Gemini returned invalid trade idea fields.");
    }
  }
  if (typeof result.insight !== "string" || typeof result.modelVersion !== "string" || typeof result.analysisVersion !== "string" || typeof result.analyzedAt !== "string") {
    throw new Error("Gemini returned invalid analysis metadata.");
  }
  if (result.suggestedTags.some((tag) => typeof tag !== "string") || result.warnings.some((warning) => typeof warning !== "string")) {
    throw new Error("Gemini returned invalid analysis labels.");
  }
}

function validateTimeframeEvidence(evidence, screenshotMetadata) {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Gemini returned invalid timeframe evidence.");
  }
  if (!Array.isArray(evidence.provided) || !Array.isArray(evidence.unavailable) || !Array.isArray(evidence.conflicts) || typeof evidence.alignmentSummary !== "string") {
    throw new Error("Gemini returned incomplete timeframe evidence.");
  }

  const suppliedTimeframes = new Set(screenshotMetadata.map((item) => item.timeframe.trim()));
  const providedTimeframes = new Set();
  for (const item of evidence.provided) {
    if (!item || typeof item !== "object" || typeof item.timeframe !== "string" || typeof item.summary !== "string") {
      throw new Error("Gemini returned invalid provided timeframe evidence.");
    }
    const timeframe = item.timeframe.trim();
    if (!suppliedTimeframes.has(timeframe) || providedTimeframes.has(timeframe)) {
      throw new Error("Gemini returned timeframe evidence that does not match the supplied screenshots.");
    }
    providedTimeframes.add(timeframe);
  }
  if (screenshotMetadata.some((item) => !providedTimeframes.has(item.timeframe.trim()))) {
    throw new Error("Gemini did not provide evidence for every supplied timeframe.");
  }
  if (evidence.unavailable.some((item) => typeof item !== "string") || evidence.conflicts.some((item) => typeof item !== "string")) {
    throw new Error("Gemini returned invalid timeframe evidence labels.");
  }
}

function validateAdditionalContextRequested(requests, screenshotMetadata) {
  if (!Array.isArray(requests) || requests.length > 3) {
    throw new Error("Gemini returned too many additional context requests.");
  }
  const suppliedTimeframes = new Set(screenshotMetadata.map((item) => item.timeframe.trim()));
  const requestedTimeframes = new Set();
  for (const request of requests) {
    if (!request || typeof request !== "object" || typeof request.timeframe !== "string" || typeof request.reason !== "string") {
      throw new Error("Gemini returned an invalid additional context request.");
    }
    const timeframe = request.timeframe.trim();
    if (!timeframe || suppliedTimeframes.has(timeframe) || requestedTimeframes.has(timeframe)) {
      throw new Error("Gemini returned an invalid additional context timeframe.");
    }
    requestedTimeframes.add(timeframe);
  }
}

function validateMainTrendAnalysis(trendAnalysis) {
  if (!trendAnalysis || typeof trendAnalysis !== "object" || Array.isArray(trendAnalysis)) {
    throw new Error("Gemini returned an invalid main trend analysis.");
  }
  if (!MAIN_TREND_VALUES.has(trendAnalysis.trend) || !TREND_STRENGTH_VALUES.has(trendAnalysis.strength) || !isConfidence(trendAnalysis.confidence)) {
    throw new Error("Gemini returned invalid main trend analysis values.");
  }
  for (const field of ["structure", "momentum", "phase", "invalidation", "summary"]) {
    if (typeof trendAnalysis[field] !== "string") {
      throw new Error("Gemini returned invalid main trend analysis fields.");
    }
  }
  for (const field of ["keySupport", "keyResistance", "reasoning"]) {
    if (!Array.isArray(trendAnalysis[field]) || trendAnalysis[field].some((item) => typeof item !== "string")) {
      throw new Error(`Gemini returned invalid main trend ${field}.`);
    }
  }
  if (trendAnalysis.reasoning.length < 3) {
    throw new Error("Gemini returned fewer than three main trend reasons.");
  }
}

function validateTradeRecommendations(recommendations) {
  if (!Array.isArray(recommendations) || recommendations.length < 3 || recommendations.length > 5) {
    throw new Error("Gemini returned an invalid number of trade recommendations.");
  }

  const requiredStyles = ["SCALP", "INTRADAY", "SWING"];
  const ids = new Set();
  recommendations.forEach((recommendation, index) => {
    if (index < requiredStyles.length && recommendation?.style !== requiredStyles[index]) {
      throw new Error("Gemini returned trade recommendations in an invalid order.");
    }
    if (index >= requiredStyles.length && recommendation?.style !== "AI_OPPORTUNITY") {
      throw new Error("Gemini returned an invalid additional trade recommendation.");
    }
    validateTradeRecommendation(recommendation);
    if (ids.has(recommendation.id)) {
      throw new Error("Gemini returned duplicate trade recommendation IDs.");
    }
    ids.add(recommendation.id);
  });
}

function validateTradeRecommendation(recommendation) {
  if (!recommendation || typeof recommendation !== "object" || Array.isArray(recommendation)) {
    throw new Error("Gemini returned an invalid trade recommendation.");
  }
  if (typeof recommendation.id !== "string" || !RECOMMENDATION_STYLE_VALUES.has(recommendation.style) || typeof recommendation.title !== "string" || !RECOMMENDATION_ACTION_VALUES.has(recommendation.action) || !isConfidence(recommendation.confidence)) {
    throw new Error("Gemini returned invalid trade recommendation metadata.");
  }
  for (const field of ["timeframeContext", "setupType", "riskReward", "summary"]) {
    if (typeof recommendation[field] !== "string") {
      throw new Error("Gemini returned invalid trade recommendation fields.");
    }
  }
  if (!recommendation.entry || typeof recommendation.entry !== "object" || Array.isArray(recommendation.entry) || ["type", "low", "high", "trigger"].some((field) => typeof recommendation.entry[field] !== "string")) {
    throw new Error("Gemini returned an invalid recommendation entry.");
  }
  if (!recommendation.stopLoss || typeof recommendation.stopLoss !== "object" || Array.isArray(recommendation.stopLoss) || ["price", "reason"].some((field) => typeof recommendation.stopLoss[field] !== "string")) {
    throw new Error("Gemini returned an invalid recommendation stop loss.");
  }
  if (!Array.isArray(recommendation.takeProfits) || recommendation.takeProfits.length > 3) {
    throw new Error("Gemini returned too many recommendation take-profit targets.");
  }
  recommendation.takeProfits.forEach((takeProfit) => {
    if (!takeProfit || typeof takeProfit !== "object" || ["label", "price", "reason"].some((field) => typeof takeProfit[field] !== "string")) {
      throw new Error("Gemini returned an invalid take-profit target.");
    }
    if (takeProfit.price.trim() && !takeProfit.reason.trim()) {
      throw new Error("Gemini returned a take-profit without a technical reason.");
    }
  });
  for (const field of ["reasons", "invalidation", "risks"]) {
    if (!Array.isArray(recommendation[field]) || recommendation[field].some((item) => typeof item !== "string") || recommendation[field].length < (field === "reasons" ? 3 : 1)) {
      throw new Error(`Gemini returned insufficient recommendation ${field}.`);
    }
  }
  if (["BUY", "SELL"].includes(recommendation.action) && !recommendation.stopLoss.reason.trim()) {
    throw new Error("Gemini returned an active recommendation without a stop-loss reason.");
  }
}

function applyDeterministicRiskReward(analysis) {
  analysis.tradeRecommendations = analysis.tradeRecommendations.map((recommendation) => {
    const entry = getNumericEntry(recommendation.entry);
    const stopLoss = parseStrictNumber(recommendation.stopLoss?.price);
    const takeProfit = recommendation.takeProfits
      .map((target) => parseStrictNumber(target.price))
      .find((price) => price !== null);

    if (!entry || stopLoss === null || takeProfit === null || !["BUY", "SELL"].includes(recommendation.action)) {
      return { ...recommendation, riskReward: "" };
    }

    const isValidDirection = recommendation.action === "BUY"
      ? stopLoss < entry && takeProfit > entry
      : stopLoss > entry && takeProfit < entry;
    if (!isValidDirection) return { ...recommendation, riskReward: "" };

    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    if (!risk || !Number.isFinite(risk) || !Number.isFinite(reward)) {
      return { ...recommendation, riskReward: "" };
    }
    const ratio = reward / risk;
    return {
      ...recommendation,
      riskReward: Number.isFinite(ratio) ? `1:${ratio.toFixed(2).replace(/\.00$/, "")}` : "",
    };
  });
}

function getNumericEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const low = parseStrictNumber(entry.low);
  const high = parseStrictNumber(entry.high);
  if (low !== null && high !== null && low === high) return low;
  if (low !== null && high === null) return low;
  if (high !== null && low === null) return high;
  return null;
}

function parseStrictNumber(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function isConfidence(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isTransientGeminiError(error) {
  const status = getErrorStatus(error);
  const errorCode = String(error?.code || error?.cause?.code || "").toUpperCase();
  const message = getErrorMessage(error);
  const isClearlyNonTransient = /authentication|unauthenticated|permission denied|api key|invalid argument|invalid request|bad request|schema|malformed/i.test(message);
  if (isClearlyNonTransient) return false;

  return status === 503
    || status === 408
    || status === 504
    || /UNAVAILABLE|temporarily unavailable|high demand/i.test(message)
    || ["ABORT_ERR", "ECONNABORTED", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"].includes(errorCode)
    || /network|fetch failed|socket hang up|timed? out|timeout/i.test(message);
}

function isQuotaOrRateLimitError(error) {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  return status === 429 || /quota|rate limit|resource exhausted|too many requests/i.test(message);
}

function isFallbackEligibleGeminiError(error) {
  return isQuotaOrRateLimitError(error) || isTransientGeminiError(error);
}

function mapError(error) {
  if (error?.scope === "persistence") {
    if ([400, 404, 409].includes(Number(error.statusCode))) {
      return { status: Number(error.statusCode), message: error.message };
    }
    return { status: 500, message: "Persistence request failed. Please try again." };
  }
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  if (status === 429 || /quota|rate limit|resource exhausted/i.test(message)) {
    return { status: 429, message: "Gemini quota or rate limit reached. Try again later." };
  }
  if (status === 401 || status === 403 || /api key|unauthenticated|permission denied/i.test(message)) {
    return { status: 502, message: "Gemini API authentication failed. Check GEMINI_API_KEY on the backend." };
  }
  if (status === 502 || /structured response|json/i.test(message)) {
    return { status: 502, message: message || "Gemini returned an invalid structured response." };
  }
  if (status === 503 || /unavailable|network|fetch|timeout|timed out/i.test(message)) {
    return { status: 503, message: "Gemini is unavailable right now. Please try again." };
  }
  return { status: 500, message: "Gemini analysis failed. Please try again." };
}

app.use((error, request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ error: "Screenshot must be 10 MB or smaller." });
      return;
    }
    response.status(400).json({ error: "The uploaded image could not be processed." });
    return;
  }
  if (error?.message === "Please upload a PNG, JPG, or JPEG screenshot.") {
    response.status(400).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError && error.status === 400 && Object.prototype.hasOwnProperty.call(error, "body")) {
    response.status(400).json({ error: "Request body must be valid JSON." });
    return;
  }
  const mapped = mapError(error);
  console.error("[analyzer]", {
    message: error?.message || "Unknown error",
    status: error?.status || error?.statusCode || error?.response?.status || null,
    code: error?.code || null,
  });
  response.status(mapped.status).json({ error: mapped.message });
});

app.listen(PORT, () => {
  console.log(`FXJourney Analyzer server listening on http://localhost:${PORT}`);
});
