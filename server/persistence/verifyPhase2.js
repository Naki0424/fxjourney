import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { closeDatabase, openDatabase } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { createPersistenceRouter } from "./routes.js";
import { insertAccount } from "./repositories/accountRepository.js";
import { insertDevice } from "./repositories/deviceRepository.js";
import { insertUserProfile } from "./repositories/userProfileRepository.js";
import { createAccountService } from "./services/accountService.js";
import { createAnalyzerPersistenceService } from "./services/analyzerPersistenceService.js";
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";
import { createClassificationService } from "./services/classificationService.js";
import { createGoalService } from "./services/goalService.js";
import { createHabitService } from "./services/habitService.js";
import { createJournalService } from "./services/journalService.js";
import { createMediaService } from "./services/mediaService.js";
import { createReflectionService } from "./services/reflectionService.js";
import { createTradeService } from "./services/tradeService.js";
import { createId, nowUtc } from "./utils.js";

function expectStatus(operation, statusCode, description) {
  assert.throws(operation, (error) => error?.statusCode === statusCode, description);
}

function createApi(database, context) {
  const app = express();
  app.use(express.json());
  app.use("/api", createPersistenceRouter({ database, getContext: () => context }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    const status = [400, 404, 409].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
    response.status(status).json({ error: status === 500 ? "Persistence request failed." : error.message });
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function requestJson(server, method, requestPath, body, headers = {}) {
  const address = server.address();
  const payload = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: address.address,
      port: address.port,
      path: requestPath,
      method,
      headers: {
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: responseBody ? JSON.parse(responseBody) : null }));
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function createForeignAccount(database) {
  const userId = createId();
  const deviceId = createId();
  const timestamp = nowUtc();
  insertUserProfile(database, {
    id: userId, displayName: "Foreign User", avatarMediaId: null, createdAt: timestamp, updatedAt: timestamp,
    deletedAt: null, version: 1, originDeviceId: deviceId, lastModifiedByDeviceId: deviceId,
  });
  insertDevice(database, {
    id: deviceId, userId, name: "Foreign Device", platform: "TEST", appVersion: null,
    createdAt: timestamp, lastSeenAt: timestamp, retiredAt: null,
  });
  const accountId = createId();
  insertAccount(database, {
    id: accountId, userId, name: "Foreign Account", brokerName: null, accountType: null,
    currencyCode: "USD", currencyMinorDigits: 2, initialBalanceMinor: null, active: true,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1,
    originDeviceId: deviceId, lastModifiedByDeviceId: deviceId,
  });
  const tradeId = createId();
  database.prepare("INSERT INTO trades (id, userId, accountId, instrument, direction, status, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    tradeId, userId, accountId, "EURUSD", "BUY", "OPEN", timestamp, timestamp, deviceId, deviceId,
  );
  return { userId, deviceId, accountId, tradeId };
}

async function runVerification() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-phase2-"));
  const databasePath = path.join(temporaryDirectory, "phase2.db");
  const identityPath = path.join(temporaryDirectory, "identity.json");
  let database;
  let apiServer;

  try {
    database = openDatabase({ filename: databasePath, wal: false });
    runMigrations(database);
    const context = bootstrapLocalInstallation({ database, identityPath });
    const accountService = createAccountService({ database, getContext: () => context });
    const tradeService = createTradeService({ database, getContext: () => context });
    const classificationService = createClassificationService({ database, getContext: () => context });
    const mediaService = createMediaService({ database, getContext: () => context, classificationService });
    const journalService = createJournalService({ database, getContext: () => context, classificationService });
    const analyzerService = createAnalyzerPersistenceService({ database, getContext: () => context, mediaService });
    const goalService = createGoalService({ database, getContext: () => context });
    const habitService = createHabitService({ database, getContext: () => context });
    const reflectionService = createReflectionService({ database, getContext: () => context });

    const account = accountService.create({ name: "Phase 2 Account", currencyCode: "USD", currencyMinorDigits: 2, initialBalanceMinor: 100000 });
    const trade = tradeService.create({ accountId: account.id, instrument: "EURUSD", direction: "BUY", status: "OPEN", openedAt: "2026-01-02T10:00:00.000Z", entryPrice: "1.08000" });
    const foreign = createForeignAccount(database);

    const tag = classificationService.createTag({ name: " Breakout  Tag " });
    assert.equal(tag.normalizedName, "breakout tag");
    expectStatus(() => classificationService.createTag({ name: "breakout    tag" }), 409, "Duplicate normalized tag was accepted.");
    const secondTag = classificationService.createTag({ name: "Momentum" });
    assert.equal(classificationService.listTags().length, 2);
    const updatedTag = classificationService.updateTag(secondTag.id, { name: "Trend Momentum" }, 1);
    assert.equal(updatedTag.version, 2);
    classificationService.removeTag(secondTag.id, 2);
    assert.equal(classificationService.listTags().some((item) => item.id === secondTag.id), false);

    const category = classificationService.createCategory({ name: "Chart Pattern", groupName: "Structure", source: "USER" });
    assert.equal(classificationService.listCategories().some((item) => item.id === category.id), true);
    const updatedCategory = classificationService.updateCategory(category.id, { description: "Pattern classification" }, 1);
    assert.equal(updatedCategory.version, 2);
    const folder = classificationService.createFolder({ name: "January Charts", sortOrder: 1 });
    const updatedFolder = classificationService.updateFolder(folder.id, { name: "January Review" }, 1);
    assert.equal(updatedFolder.version, 2);

    const session = analyzerService.createSession({ linkedTradeId: trade.id, instrument: "EURUSD", primaryTimeframe: "15m", context: { source: "verification" } });
    const journal = journalService.create({
      tradeId: trade.id,
      analysisSessionId: session.id,
      title: "Breakout review",
      body: "The planned breakout was monitored carefully.",
      mood: "POSITIVE",
      wentWell: ["Waited for confirmation"],
      improvements: ["Document the retest"],
      takeaway: "Patience preserved the plan.",
      tagIds: [tag.id],
    });
    assert.equal(journal.wentWell[0], "Waited for confirmation");
    assert.equal(journalService.get(journal.id).tags.length, 1);
    const updatedJournal = journalService.update(journal.id, { takeaway: "Use the same patience next time." }, 1);
    assert.equal(updatedJournal.version, 2);
    expectStatus(() => journalService.update(journal.id, { body: "Stale" }, 1), 409, "Stale journal update was accepted.");
    expectStatus(() => journalService.create({ tradeId: foreign.tradeId, body: "Foreign link", mood: "NEUTRAL" }), 404, "Foreign journal trade link was accepted.");
    expectStatus(() => classificationService.attachJournalTag(journal.id, secondTag.id), 404, "Deleted tag was attachable.");
    const journalTag = classificationService.listJournalTags(journal.id).find((item) => item.tagId === tag.id);
    classificationService.detachJournalTag(journal.id, tag.id, journalTag.version);

    const media = mediaService.create({
      tradeId: trade.id, journalEntryId: journal.id, folderId: folder.id, originalFilename: "chart.png",
      mimeType: "image/png", byteSize: 2048, width: 1200, height: 800, capturedAt: "2026-01-02T09:00:00Z",
      storageKey: "media/2026/chart.png", thumbnailKey: "media/2026/thumb-chart.png", checksumSha256: "abc123", source: "UPLOAD",
      favorite: true, availabilityStatus: "AVAILABLE",
    });
    expectStatus(() => mediaService.create({ originalFilename: "absolute.png", mimeType: "image/png", byteSize: 1, storageKey: "C:\\private\\chart.png", checksumSha256: "abs", source: "UPLOAD" }), 400, "Absolute storageKey was accepted.");
    assert.equal(mediaService.list({ checksumSha256: "abc123" })[0].id, media.id);
    const updatedMedia = mediaService.update(media.id, { favorite: false }, 1);
    assert.equal(updatedMedia.version, 2);
    const secondMedia = mediaService.create({ originalFilename: "chart-2.png", mimeType: "image/png", byteSize: 100, storageKey: "media/chart-2.png", checksumSha256: "def456", source: "UPLOAD" });
    mediaService.remove(secondMedia.id, 1);
    assert.equal(mediaService.list().some((item) => item.id === secondMedia.id), false);
    classificationService.attachMediaTag(media.id, tag.id);
    expectStatus(() => classificationService.attachMediaTag(media.id, tag.id), 409, "Duplicate media tag was accepted.");
    const mediaTag = classificationService.listMediaTags(media.id)[0];
    classificationService.detachMediaTag(media.id, tag.id, mediaTag.version);
    const mediaCategory = classificationService.attachMediaCategory(media.id, { categoryId: category.id, source: "AI", confidence: "0.8750", confirmed: true });
    assert.equal(mediaCategory.confirmed, true);
    assert.equal(mediaCategory.confidence, "0.8750");
    expectStatus(() => classificationService.attachMediaCategory(media.id, { categoryId: category.id }), 409, "Duplicate media category was accepted.");
    const updatedMediaCategory = classificationService.updateMediaCategory(media.id, category.id, { confirmed: false }, 1);
    assert.equal(updatedMediaCategory.version, 2);
    classificationService.detachMediaCategory(media.id, category.id, 2);

    classificationService.attachTradeTag(trade.id, tag.id);
    expectStatus(() => classificationService.attachTradeTag(trade.id, tag.id), 409, "Duplicate trade tag was accepted.");
    const tradeTag = classificationService.listTradeTags(trade.id)[0];
    classificationService.detachTradeTag(trade.id, tag.id, tradeTag.version);

    const folderBeforeDelete = classificationService.getFolder(folder.id);
    classificationService.removeFolder(folder.id, folderBeforeDelete.version);
    const mediaAfterFolderDelete = mediaService.get(media.id);
    assert.equal(mediaAfterFolderDelete.id, media.id);
    assert.equal(mediaAfterFolderDelete.folderId, null, "Folder deletion removed media metadata or left an invalid folder reference.");
    mediaService.remove(media.id, mediaAfterFolderDelete.version);
    assert.equal(mediaService.list().some((item) => item.id === media.id), false);
    classificationService.removeCategory(category.id, updatedCategory.version);
    journalService.remove(journal.id, 2);
    assert.equal(journalService.list().some((item) => item.id === journal.id), false);
    classificationService.removeTag(tag.id, tag.version);
    assert.equal(classificationService.listTags().some((item) => item.id === tag.id), false);

    const activeMedia1 = mediaService.create({ originalFilename: "session-1.png", mimeType: "image/png", byteSize: 10, storageKey: "session/1.png", checksumSha256: "s1", source: "ANALYZER" });
    const activeMedia2 = mediaService.create({ originalFilename: "session-2.png", mimeType: "image/png", byteSize: 11, storageKey: "session/2.png", checksumSha256: "s2", source: "ANALYZER" });
    const sessionMedia1 = analyzerService.attachSessionMedia(session.id, { mediaId: activeMedia1.id, timeframe: "15m", ordinal: 1, isPrimary: true });
    const sessionMedia2 = analyzerService.attachSessionMedia(session.id, { mediaId: activeMedia2.id, timeframe: "15m", ordinal: 2 });
    assert.equal(analyzerService.listSessionMedia(session.id).length, 2);
    assert.equal(sessionMedia1.isPrimary, true);
    assert.equal(sessionMedia2.timeframe, "15m");
    expectStatus(() => analyzerService.attachSessionMedia(session.id, { mediaId: activeMedia1.id, timeframe: "1h", ordinal: 3 }), 409, "Duplicate session/media relationship was accepted.");
    expectStatus(() => analyzerService.attachSessionMedia(session.id, { mediaId: activeMedia2.id, timeframe: "1h", ordinal: 1 }), 409, "Duplicate session ordinal was accepted.");
    const report1 = analyzerService.appendReport(session.id, { modelId: "test-model", analysisSchemaVersion: "1", timeframesUsed: ["15m"], result: { trend: "BULLISH" }, analyzedAt: "2026-01-02T10:00:00Z" });
    const report2 = analyzerService.appendReport(session.id, { modelId: "test-model", analysisSchemaVersion: "1", timeframesUsed: ["15m", "1h"], result: { trend: "TRANSITIONAL" }, previousReportId: report1.id, analyzedAt: "2026-01-02T11:00:00Z" });
    assert.equal(analyzerService.listReports(session.id)[0].versionNumber, 1);
    assert.equal(analyzerService.listReports(session.id)[1].versionNumber, 2);
    assert.equal(analyzerService.latestReport(session.id).id, report2.id);
    assert.deepEqual(analyzerService.getReport(report1.id).result, { trend: "BULLISH" });
    const otherSession = analyzerService.createSession({ instrument: "USDJPY", primaryTimeframe: "1h" });
    expectStatus(() => analyzerService.appendReport(otherSession.id, { modelId: "test-model", analysisSchemaVersion: "1", timeframesUsed: ["1h"], result: {}, previousReportId: report1.id }), 400, "Cross-session previousReportId was not rejected.");
    assert.equal(typeof analyzerService.updateReport, "undefined", "Analyzer reports unexpectedly expose an update operation.");
    const feedback = analyzerService.createFeedback(report1.id, { rating: "HELPFUL", note: "Useful" });
    assert.equal(feedback.rating, "HELPFUL");
    expectStatus(() => analyzerService.createFeedback(report1.id, { rating: "NOT_HELPFUL" }), 409, "Multiple active report feedback records were accepted.");
    const updatedFeedback = analyzerService.updateFeedback(feedback.id, { rating: "NOT_HELPFUL" }, 1);
    assert.equal(updatedFeedback.version, 2);
    analyzerService.removeFeedback(feedback.id, 2);
    const secondFeedback = analyzerService.createFeedback(report1.id, { rating: "NOT_HELPFUL" });
    assert.equal(secondFeedback.rating, "NOT_HELPFUL");
    analyzerService.detachSessionMedia(session.id, activeMedia1.id, sessionMedia1.version);

    const automaticGoal = goalService.create({ accountId: account.id, title: "Protect risk", progressMode: "AUTOMATIC", metricType: "MAX_RISK_PERCENT", targetValue: "1.0000", targetUnit: "%", targetOperator: "LTE", periodStart: "2026-01-01", periodEnd: "2026-01-31", status: "ACTIVE", rule: { source: "trades" } });
    const manualGoal = goalService.create({ title: "Trading days", progressMode: "MANUAL", metricType: "TRADING_DAYS", targetValue: "20", targetUnit: "days", targetOperator: "GTE", manualCurrentValue: "3" });
    assert.equal(automaticGoal.rule.source, "trades");
    assert.equal(manualGoal.manualCurrentValue, "3");
    const updatedGoal = goalService.update(automaticGoal.id, { description: "Keep risk controlled." }, 1);
    assert.equal(updatedGoal.version, 2);
    expectStatus(() => goalService.update(automaticGoal.id, { description: "Stale" }, 1), 409, "Stale goal update was accepted.");
    expectStatus(() => goalService.create({ accountId: foreign.accountId, title: "Foreign", progressMode: "MANUAL", metricType: "CUSTOM" }), 404, "Foreign goal account was accepted.");
    expectStatus(() => goalService.create({ title: "Bad dates", progressMode: "MANUAL", metricType: "CUSTOM", periodStart: "2026-02-01", periodEnd: "2026-01-01" }), 400, "Invalid goal date range was accepted.");
    const milestone = goalService.createMilestone(automaticGoal.id, { title: "First review", targetDate: "2026-01-10", sortOrder: 1 });
    assert.equal(goalService.listMilestones(automaticGoal.id).length, 1);
    const updatedMilestone = goalService.updateMilestone(automaticGoal.id, milestone.id, { achievedAt: "2026-01-10T12:00:00Z" }, 1);
    assert.equal(updatedMilestone.version, 2);
    goalService.removeMilestone(automaticGoal.id, milestone.id, 2);
    goalService.remove(manualGoal.id, 1);
    assert.equal(goalService.list().some((goal) => goal.id === manualGoal.id), false);

    const habit = habitService.create({ name: "Review charts", description: "Daily review", frequency: "DAILY", expectedWeekdays: [1, 2, 3, 4, 5], sortOrder: 1 });
    assert.equal(habit.expectedWeekdays[0], 1);
    const statuses = ["COMPLETED", "MISSED", "SKIPPED", "NOT_APPLICABLE"];
    const entries = statuses.map((status, index) => habitService.setEntry(habit.id, { entryDate: `2026-01-0${index + 1}`, status }));
    assert.equal(entries[1].status, "MISSED");
    expectStatus(() => habitService.setEntry(habit.id, { entryDate: "2026-01-01", status: "SKIPPED" }), 409, "Duplicate active habit/date was accepted.");
    const changedEntry = habitService.setEntry(habit.id, { entryDate: "2026-01-01", status: "SKIPPED" }, 1);
    assert.equal(changedEntry.version, 2);
    assert.equal(habitService.listEntries(habit.id, "2026-01-01", "2026-01-04").length, 4);
    expectStatus(() => habitService.getEntry(habit.id, "2026-01-10"), 404, "Missing habit date created an implicit entry.");
    habitService.removeEntry(habit.id, entries[1].id, 1);
    assert.equal(habitService.listEntries(habit.id).some((entry) => entry.id === entries[1].id), false);
    assert.equal(database.prepare("SELECT name FROM pragma_table_info('habits') WHERE name LIKE '%score%'").all().length, 0, "Habit score was persisted in schema.");
    habitService.remove(habit.id, 1);

    const reflection = reflectionService.create({ weekStart: "2026-01-04", body: "A steady week." });
    expectStatus(() => reflectionService.create({ weekStart: "2026-01-04", body: "Duplicate" }), 409, "Duplicate active weekly reflection was accepted.");
    const updatedReflection = reflectionService.update(reflection.id, { body: "A more deliberate week." }, 1);
    assert.equal(updatedReflection.version, 2);
    reflectionService.remove(reflection.id, 2);
    assert.equal(reflectionService.list().some((item) => item.id === reflection.id), false);

    apiServer = await listen(createApi(database, context));
    assert.equal((await requestJson(apiServer, "GET", "/api/journal")).status, 200);
    assert.equal((await requestJson(apiServer, "POST", "/api/media", { originalFilename: "api.png", mimeType: "image/png", byteSize: 12, storageKey: "api/api.png", checksumSha256: "api-media", source: "UPLOAD" })).status, 201);
    assert.equal((await requestJson(apiServer, "POST", "/api/analyzer/sessions", { instrument: "GBPUSD", primaryTimeframe: "1h" })).status, 201);
    assert.equal((await requestJson(apiServer, "POST", "/api/goals", { title: "API goal", progressMode: "MANUAL", metricType: "CUSTOM", targetValue: "1", targetOperator: "GTE" })).status, 201);
    assert.equal((await requestJson(apiServer, "POST", "/api/habits", { name: "API habit", frequency: "WEEKLY" })).status, 201);
    const apiGoal = (await requestJson(apiServer, "POST", "/api/goals", { title: "API versioned goal", progressMode: "MANUAL", metricType: "CUSTOM", targetValue: "2", targetOperator: "GTE" })).body.goal;
    assert.equal((await requestJson(apiServer, "PATCH", `/api/goals/${apiGoal.id}`, { description: "API update", expectedVersion: 1 })).status, 200);
    assert.equal((await requestJson(apiServer, "PATCH", `/api/goals/${apiGoal.id}`, { description: "API stale", expectedVersion: 1 })).status, 409);
    assert.equal((await requestJson(apiServer, "GET", "/api/goals/missing-goal")).status, 404);
    assert.equal((await requestJson(apiServer, "POST", "/api/habits", { name: "Invalid habit", frequency: "INVALID" })).status, 400);

    return { temporaryDirectory };
  } finally {
    if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
    if (database) closeDatabase(database);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  const result = await runVerification();
  console.log("Phase 2 persistence verification passed: journal, classification, media metadata, relationships, Analyzer, goals, habits, reflections, and representative API routes");
  console.log(`Temporary verification data cleaned: ${!fs.existsSync(result.temporaryDirectory)}`);
} catch (error) {
  console.error(`Phase 2 persistence verification failed: ${error.message}`);
  process.exitCode = 1;
}
