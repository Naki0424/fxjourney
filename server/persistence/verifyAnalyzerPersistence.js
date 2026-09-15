import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { closeDatabase, openDatabase } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { createPersistenceRouter } from "./routes.js";
import { createAnalyzerPersistenceService } from "./services/analyzerPersistenceService.js";
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";
import { createClassificationService } from "./services/classificationService.js";
import { createMediaService } from "./services/mediaService.js";
import { createMediaStorage } from "./mediaStorage.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function fixtureFile(filename) {
  return { buffer: PNG_1X1, mimetype: "image/png", originalname: filename };
}

function fixtureResult(version, timeframes) {
  return {
    analysisId: `fixture-analysis-${version}`,
    status: "completed",
    analysisVersion: "1",
    modelVersion: "fixture-model",
    analyzedAt: `2026-09-15T10:0${version}:00.000Z`,
    confidence: 0.75,
    detectedCategories: [],
    suggestedCategories: [],
    suggestedTags: timeframes,
    mainTrendAnalysis: {
      trend: version === 1 ? "BULLISH" : "TRANSITIONAL",
      strength: "MODERATE",
      confidence: 0.75,
      structure: "Higher highs",
      momentum: "Building",
      phase: "Expansion",
      keySupport: ["1.0800"],
      keyResistance: ["1.0900"],
      reasoning: ["Visible swing structure", "Momentum supports the read", "Key level remains respected"],
      invalidation: "A close below support weakens the thesis.",
      summary: `Fixture report ${version}.`,
    },
    tradeRecommendations: ["SCALP", "INTRADAY", "SWING"].map((style) => ({
      id: `${style.toLowerCase()}-${version}`,
      style,
      title: `${style} fixture recommendation`,
      action: style === "SWING" && version > 1 ? "WAIT" : "BUY",
      confidence: 0.6,
      timeframeContext: timeframes.join(" + "),
      setupType: "Continuation",
      entry: { type: "ZONE", low: "1.0800", high: "1.0810", trigger: "Break and retest" },
      stopLoss: { price: "1.0750", reason: "Below structure" },
      takeProfits: [{ label: "TP1", price: "1.0900", reason: "Prior resistance" }],
      riskReward: "1:2",
      reasons: ["Structure", "Momentum", "Level reaction"],
      invalidation: ["Structure breaks"],
      risks: ["Conflicting higher timeframe evidence"],
      summary: `Fixture ${style} report ${version}.`,
    })),
    timeframeEvidence: {
      provided: timeframes.map((timeframe) => ({ timeframe, summary: `${timeframe} fixture evidence` })),
      unavailable: [],
      conflicts: [],
      alignmentSummary: "Fixture evidence is aligned.",
    },
    additionalContextRequested: [],
    patternAnalysis: { primaryPattern: "Continuation", confidence: 0.6, summary: "Fixture pattern.", observations: ["Test observation"] },
    keyLevels: [{ id: "support", type: "SUPPORT", label: "Support", price: "1.0800", priceLow: "", priceHigh: "" }],
    marketContext: { trend: "BULLISH", timeframe: timeframes.at(-1), instrument: "EURUSD", session: "London" },
    marketStructure: { trend: "BULLISH", bias: "BUY", structure: "Higher highs" },
    tradeIdea: { direction: "BUY", entry: "1.0800", stopLoss: "1.0750", takeProfit: "1.0900", riskReward: "1:2" },
    insight: "Fixture insight.",
    warnings: ["Verify manually."],
  };
}

function createApi(database, context, mediaStorage) {
  const app = express();
  app.use(express.json());
  app.use("/api", createPersistenceRouter({ database, getContext: () => context, mediaStorage }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = [400, 404, 409].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
    return response.status(status).json({ error: error.message });
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, method, requestPath) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const requestInstance = http.request({ hostname: address.address, port: address.port, path: requestPath, method }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: responseBody ? JSON.parse(responseBody) : null }));
    });
    requestInstance.on("error", reject);
    requestInstance.end();
  });
}

async function runVerification() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-analyzer-"));
  const databasePath = path.join(temporaryDirectory, "analyzer.db");
  const identityPath = path.join(temporaryDirectory, "local-identity.json");
  let database;
  let apiServer;

  try {
    database = openDatabase({ filename: databasePath, wal: false });
    runMigrations(database);
    let context = bootstrapLocalInstallation({ database, identityPath });
    let classificationService = createClassificationService({ database, getContext: () => context });
    let mediaStorage = createMediaStorage({ rootDirectory: path.join(temporaryDirectory, "media") });
    let mediaService = createMediaService({ database, getContext: () => context, classificationService, mediaStorage });
    let analyzerService = createAnalyzerPersistenceService({ database, getContext: () => context, mediaService });

    const report1 = analyzerService.persistSuccessfulAnalysis({
      sessionFields: { instrument: "EURUSD", primaryTimeframe: "15m", context: { source: "fixture" } },
      screenshotEntries: [{ id: "client-primary", timeframe: "15m", file: fixtureFile("15m.png") }],
      report: { modelId: "fixture-primary-model", analysisSchemaVersion: "1", timeframesUsed: ["15m"], analyzedAt: "2026-09-15T10:01:00.000Z", result: fixtureResult(1, ["15m"]) },
    });
    assert.equal(report1.report.versionNumber, 1);
    assert.equal(report1.report.previousReportId, null);
    const primaryMediaId = report1.screenshots[0].mediaId;
    const report1Snapshot = JSON.stringify(report1.report.result);

    const report2 = analyzerService.persistSuccessfulAnalysis({
      sessionId: report1.session.id,
      screenshotEntries: [
        { id: primaryMediaId, timeframe: "15m", file: fixtureFile("15m.png") },
        { id: "client-1h", timeframe: "1H", file: fixtureFile("1h.png") },
      ],
      report: { modelId: "fixture-fallback-model", analysisSchemaVersion: "1", timeframesUsed: ["15m", "1H"], analyzedAt: "2026-09-15T10:02:00.000Z", result: fixtureResult(2, ["15m", "1H"]) },
    });
    assert.equal(report2.report.versionNumber, 2);
    assert.equal(report2.report.previousReportId, report1.report.id);

    const firstTwoMediaIds = report2.screenshots.map((item) => item.mediaId);
    const report3 = analyzerService.persistSuccessfulAnalysis({
      sessionId: report1.session.id,
      screenshotEntries: [
        { id: firstTwoMediaIds[0], timeframe: "15m", file: fixtureFile("15m.png") },
        { id: firstTwoMediaIds[1], timeframe: "1H", file: fixtureFile("1h.png") },
        { id: "client-4h", timeframe: "4H", file: fixtureFile("4h.png") },
      ],
      report: { modelId: "fixture-primary-model", analysisSchemaVersion: "1", timeframesUsed: ["15m", "1H", "4H"], analyzedAt: "2026-09-15T10:03:00.000Z", result: fixtureResult(3, ["15m", "1H", "4H"]) },
    });
    assert.equal(report3.report.versionNumber, 3);
    assert.equal(report3.report.previousReportId, report2.report.id);
    assert.deepEqual(report3.report.timeframesUsed, ["15m", "1H", "4H"]);
    const inProcessReports = analyzerService.listReports(report1.session.id);
    assert.equal(JSON.stringify(inProcessReports[0].result), report1Snapshot);
    assert.equal(analyzerService.latestReport(report1.session.id).id, report3.report.id);

    const staleVersion = report3.session.version;
    const updatedSession = analyzerService.updateSession(report1.session.id, { context: { source: "fixture", resumed: true } }, staleVersion);
    assert.equal(updatedSession.version, staleVersion + 1);
    assert.throws(() => analyzerService.updateSession(report1.session.id, { context: { source: "stale" } }, staleVersion), (error) => error?.statusCode === 409);

    closeDatabase(database);
    database = openDatabase({ filename: databasePath, wal: false });
    runMigrations(database);
    context = bootstrapLocalInstallation({ database, identityPath });
    classificationService = createClassificationService({ database, getContext: () => context });
    mediaStorage = createMediaStorage({ rootDirectory: path.join(temporaryDirectory, "media") });
    mediaService = createMediaService({ database, getContext: () => context, classificationService, mediaStorage });
    analyzerService = createAnalyzerPersistenceService({ database, getContext: () => context, mediaService });
    const resumedState = analyzerService.getSessionState(report1.session.id);
    assert.equal(resumedState.reports.length, 3);
    assert.deepEqual(resumedState.reports.map((report) => report.versionNumber), [1, 2, 3]);
    assert.deepEqual(resumedState.reports.map((report) => report.timeframesUsed), [["15m"], ["15m", "1H"], ["15m", "1H", "4H"]]);
    assert.equal(JSON.stringify(resumedState.reports[0].result), report1Snapshot);
    assert.equal(resumedState.screenshots.length, 3);

    apiServer = await listen(createApi(database, context, mediaStorage));
    const historyResponse = await request(apiServer, "GET", `/api/analyzer/sessions/${report1.session.id}/reports/1`);
    const latestResponse = await request(apiServer, "GET", `/api/analyzer/sessions/${report1.session.id}/reports/latest`);
    assert.equal(historyResponse.status, 200);
    assert.equal(historyResponse.body.report.id, report1.report.id);
    assert.equal(latestResponse.status, 200);
    assert.equal(latestResponse.body.report.id, report3.report.id);

    mediaService.removeScreenshot(primaryMediaId, 1);
    const afterScreenshotDelete = analyzerService.getSessionState(report1.session.id);
    assert.equal(afterScreenshotDelete.screenshots[0].media.unavailable, true);
    assert.equal(afterScreenshotDelete.reports.length, 3);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM analysis_report_versions WHERE sessionId = ?").get(report1.session.id).count, 3);

    assert.throws(() => analyzerService.persistSuccessfulAnalysis({
      sessionFields: { primaryTimeframe: "15m" },
      screenshotEntries: [{ id: "invalid", timeframe: "15m", file: { buffer: Buffer.from("bad"), mimetype: "image/png", originalname: "bad.png" } }],
      report: { modelId: "fixture-model", analysisSchemaVersion: "1", timeframesUsed: ["15m"], analyzedAt: "2026-09-15T10:04:00.000Z", result: fixtureResult(4, ["15m"]) },
    }), (error) => error?.statusCode === 400);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM analysis_report_versions").get().count, 3);

    return { temporaryDirectory };
  } finally {
    if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
    if (database) closeDatabase(database);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  const result = await runVerification();
  console.log("Analyzer persistence verification passed: session resume, media membership, immutable reports, server sequencing, restart reconstruction, history reads, stale updates, and screenshot deletion preservation");
  console.log(`Temporary verification data cleaned: ${!fs.existsSync(result.temporaryDirectory)}`);
} catch (error) {
  console.error(`Analyzer persistence verification failed: ${error.message}`);
  process.exitCode = 1;
}
