import { normalizeAnalysisResult } from "../utils/normalizeAnalysisResult";

export async function analyzeScreenshot({ file, screenshots = [], context = {} }) {
  const screenshotEntries = screenshots.length
    ? screenshots
    : file?.file
      ? [{ id: "primary", timeframe: context?.knownTimeframe || "15m", file }]
      : [];

  if (!screenshotEntries.length || screenshotEntries.some((entry) => !entry?.file?.file || !entry?.timeframe)) {
    throw new Error("An uploaded screenshot is required.");
  }

  const formData = new FormData();
  screenshotEntries.forEach((entry) => {
    formData.append("images", entry.file.file, entry.file.filename);
  });
  formData.append("screenshotMeta", JSON.stringify(screenshotEntries.map((entry) => ({
    id: entry.id,
    timeframe: entry.timeframe,
  }))));
  formData.append("context", JSON.stringify(context ?? {}));

  let response;
  try {
    response = await fetch("/api/analyze-chart", {
      method: "POST",
      body: formData,
    });
  } catch {
    throw new Error("The Analyzer server is unavailable. Start the backend and try again.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The Analyzer server returned an invalid response.");
  }

  if (!response.ok) {
    throw new Error(payload?.error || "The Analyzer server could not analyze this screenshot.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("The Analyzer returned an invalid structured response.");
  }

  const rawAnalysis = payload.analysis || payload;
  if (import.meta.env.DEV) {
    console.debug("[analyzer][dev] Frontend response before normalization", rawAnalysis);
  }
  if (!hasRequiredAnalysisContract(rawAnalysis)) {
    throw new Error("The Analyzer response is missing Main Trend Analysis or the required trade recommendations. Restart the backend and try again.");
  }

  const normalizedResult = normalizeAnalysisResult(rawAnalysis);
  if (import.meta.env.DEV) {
    console.debug("[analyzer][dev] Normalized result", normalizedResult);
  }
  return normalizedResult;
}

function hasRequiredAnalysisContract(value) {
  const trendAnalysis = value?.mainTrendAnalysis;
  const recommendations = value?.tradeRecommendations;
  const requiredTrendFields = [
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
  ];
  const requiredStyles = ["SCALP", "INTRADAY", "SWING"];

  return Boolean(
    trendAnalysis
      && typeof trendAnalysis === "object"
      && requiredTrendFields.every((field) => Object.prototype.hasOwnProperty.call(trendAnalysis, field))
      && Array.isArray(trendAnalysis.reasoning)
      && trendAnalysis.reasoning.length >= 3
      && Array.isArray(recommendations)
      && recommendations.length >= 3
      && recommendations.length <= 5
      && requiredStyles.every((style, index) => recommendations[index]?.style === style)
      && value.timeframeEvidence
      && typeof value.timeframeEvidence === "object"
      && Array.isArray(value.timeframeEvidence.provided)
      && Array.isArray(value.timeframeEvidence.unavailable)
      && Array.isArray(value.timeframeEvidence.conflicts)
      && typeof value.timeframeEvidence.alignmentSummary === "string"
      && Array.isArray(value.additionalContextRequested)
      && value.additionalContextRequested.length <= 3,
  );
}
