import express from "express";
import { badRequest } from "./errors.js";
import { createAccountService } from "./services/accountService.js";
import { createTradeService } from "./services/tradeService.js";
import { createAnalyzerPersistenceService } from "./services/analyzerPersistenceService.js";
import { createClassificationService } from "./services/classificationService.js";
import { createGoalService } from "./services/goalService.js";
import { createHabitService } from "./services/habitService.js";
import { createJournalService } from "./services/journalService.js";
import { createMediaService } from "./services/mediaService.js";
import { createReflectionService } from "./services/reflectionService.js";

export function createPersistenceRouter({ database, getContext, mediaStorage, uploadMiddleware }) {
  const router = express.Router();
  const accountService = createAccountService({ database, getContext });
  const tradeService = createTradeService({ database, getContext });
  const classificationService = createClassificationService({ database, getContext });
  const mediaService = createMediaService({ database, getContext, classificationService, mediaStorage });
  const journalService = createJournalService({ database, getContext, classificationService });
  const analyzerService = createAnalyzerPersistenceService({ database, getContext, mediaService });
  const goalService = createGoalService({ database, getContext });
  const habitService = createHabitService({ database, getContext });
  const reflectionService = createReflectionService({ database, getContext });

  router.get("/bootstrap", (request, response) => {
    response.json(getContext().getBootstrap());
  });

  router.get("/accounts", (request, response) => {
    response.json({ accounts: accountService.list() });
  });
  router.post("/accounts", (request, response) => {
    response.status(201).json({ account: accountService.create(request.body) });
  });
  router.get("/accounts/:id", (request, response) => {
    response.json({ account: accountService.get(request.params.id) });
  });
  router.patch("/accounts/:id", (request, response) => {
    response.json({
      account: accountService.update(request.params.id, request.body, expectedVersion(request)),
    });
  });
  router.delete("/accounts/:id", (request, response) => {
    accountService.remove(request.params.id, expectedVersion(request));
    response.status(204).end();
  });

  router.get("/trades", (request, response) => {
    response.json({ trades: tradeService.list(request.query) });
  });
  router.post("/trades", (request, response) => {
    response.status(201).json({ trade: tradeService.create(request.body) });
  });
  router.get("/trades/:id", (request, response) => {
    response.json({ trade: tradeService.get(request.params.id) });
  });
  router.patch("/trades/:id", (request, response) => {
    response.json({
      trade: tradeService.update(request.params.id, request.body, expectedVersion(request)),
    });
  });
  router.delete("/trades/:id", (request, response) => {
    tradeService.remove(request.params.id, expectedVersion(request));
    response.status(204).end();
  });

  router.get("/journal", (request, response) => response.json({ entries: journalService.list() }));
  router.post("/journal", (request, response) => response.status(201).json({ entry: journalService.create(request.body) }));
  router.get("/journal/:id", (request, response) => response.json({ entry: journalService.get(request.params.id) }));
  router.patch("/journal/:id", (request, response) => response.json({ entry: journalService.update(request.params.id, request.body, expectedVersion(request)) }));
  router.delete("/journal/:id", (request, response) => { journalService.remove(request.params.id, expectedVersion(request)); response.status(204).end(); });
  router.get("/journal/:journalEntryId/tags", (request, response) => response.json({ tags: classificationService.listJournalTags(request.params.journalEntryId) }));
  router.post("/journal/:journalEntryId/tags", (request, response) => response.status(201).json({ tag: classificationService.attachJournalTag(request.params.journalEntryId, request.body?.tagId) }));
  router.delete("/journal/:journalEntryId/tags/:tagId", (request, response) => { classificationService.detachJournalTag(request.params.journalEntryId, request.params.tagId, expectedVersion(request)); response.status(204).end(); });

  router.get("/tags", (request, response) => response.json({ tags: classificationService.listTags() }));
  router.post("/tags", (request, response) => response.status(201).json({ tag: classificationService.createTag(request.body) }));
  router.get("/tags/:id", (request, response) => response.json({ tag: classificationService.getTag(request.params.id) }));
  router.patch("/tags/:id", (request, response) => response.json({ tag: classificationService.updateTag(request.params.id, request.body, expectedVersion(request)) }));
  router.delete("/tags/:id", (request, response) => { classificationService.removeTag(request.params.id, expectedVersion(request)); response.status(204).end(); });

  router.get("/categories", (request, response) => response.json({ categories: classificationService.listCategories() }));
  router.post("/categories", (request, response) => response.status(201).json({ category: classificationService.createCategory(request.body) }));
  router.get("/categories/:id", (request, response) => response.json({ category: classificationService.getCategory(request.params.id) }));
  router.patch("/categories/:id", (request, response) => response.json({ category: classificationService.updateCategory(request.params.id, request.body, expectedVersion(request)) }));
  router.delete("/categories/:id", (request, response) => { classificationService.removeCategory(request.params.id, expectedVersion(request)); response.status(204).end(); });

  router.get("/folders", (request, response) => response.json({ folders: classificationService.listFolders() }));
  router.post("/folders", (request, response) => response.status(201).json({ folder: classificationService.createFolder(request.body) }));
  router.get("/folders/:id", (request, response) => response.json({ folder: classificationService.getFolder(request.params.id) }));
  router.patch("/folders/:id", (request, response) => response.json({ folder: classificationService.updateFolder(request.params.id, request.body, expectedVersion(request)) }));
  router.delete("/folders/:id", (request, response) => { classificationService.removeFolder(request.params.id, expectedVersion(request)); response.status(204).end(); });

  router.get("/media", (request, response) => response.json({ media: mediaService.list(request.query) }));
  router.post("/media", (request, response) => response.status(201).json({ media: mediaService.create(request.body) }));
  router.get("/media/:id", (request, response) => response.json({ media: mediaService.get(request.params.id) }));
  router.patch("/media/:id", (request, response) => response.json({ media: mediaService.update(request.params.id, request.body, expectedVersion(request)) }));
  router.delete("/media/:id", (request, response) => { mediaService.remove(request.params.id, expectedVersion(request)); response.status(204).end(); });

  router.get("/screenshots", (request, response) => response.json({ screenshots: mediaService.listScreenshots(request.query) }));
  router.get("/screenshots/:id/content", (request, response) => {
    const { media, buffer } = mediaService.readScreenshot(request.params.id);
    response.set("Content-Type", media.mimeType);
    response.set("Content-Length", String(buffer.length));
    response.set("Cache-Control", "private, max-age=3600");
    response.send(buffer);
  });
  router.get("/screenshots/:id", (request, response) => response.json({ screenshot: mediaService.getScreenshot(request.params.id) }));
  router.patch("/screenshots/:id", (request, response) => response.json({ screenshot: mediaService.updateScreenshot(request.params.id, request.body, expectedVersion(request)) }));
  router.delete("/screenshots/:id", (request, response) => { mediaService.removeScreenshot(request.params.id, expectedVersion(request)); response.status(204).end(); });
  if (uploadMiddleware) {
    router.post("/screenshots", uploadMiddleware.single("file"), (request, response) => {
      if (!request.file) throw badRequest("A screenshot file is required.");
      const metadata = parseUploadMetadata(request.body?.metadata);
      response.status(201).json({ screenshot: mediaService.createUploadedScreenshot({ file: request.file, metadata }) });
    });
  }

  router.get("/trades/:tradeId/tags", (request, response) => response.json({ tags: classificationService.listTradeTags(request.params.tradeId) }));
  router.post("/trades/:tradeId/tags", (request, response) => response.status(201).json({ tag: classificationService.attachTradeTag(request.params.tradeId, request.body?.tagId) }));
  router.delete("/trades/:tradeId/tags/:tagId", (request, response) => { classificationService.detachTradeTag(request.params.tradeId, request.params.tagId, expectedVersion(request)); response.status(204).end(); });
  router.get("/media/:mediaId/tags", (request, response) => response.json({ tags: classificationService.listMediaTags(request.params.mediaId) }));
  router.post("/media/:mediaId/tags", (request, response) => response.status(201).json({ tag: classificationService.attachMediaTag(request.params.mediaId, request.body?.tagId) }));
  router.delete("/media/:mediaId/tags/:tagId", (request, response) => { classificationService.detachMediaTag(request.params.mediaId, request.params.tagId, expectedVersion(request)); response.status(204).end(); });
  router.get("/media/:mediaId/categories", (request, response) => response.json({ categories: classificationService.listMediaCategories(request.params.mediaId) }));
  router.post("/media/:mediaId/categories", (request, response) => response.status(201).json({ category: classificationService.attachMediaCategory(request.params.mediaId, request.body) }));
  router.patch("/media/:mediaId/categories/:categoryId", (request, response) => response.json({ category: classificationService.updateMediaCategory(request.params.mediaId, request.params.categoryId, request.body, expectedVersion(request)) }));
  router.delete("/media/:mediaId/categories/:categoryId", (request, response) => { classificationService.detachMediaCategory(request.params.mediaId, request.params.categoryId, expectedVersion(request)); response.status(204).end(); });

  router.get("/analyzer/sessions", (request, response) => response.json({ sessions: analyzerService.listSessions() }));
  router.post("/analyzer/sessions", (request, response) => response.status(201).json({ session: analyzerService.createSession(request.body) }));
  router.get("/analyzer/sessions/:sessionId", (request, response) => response.json({ session: analyzerService.getSession(request.params.sessionId) }));
  router.patch("/analyzer/sessions/:sessionId", (request, response) => response.json({ session: analyzerService.updateSession(request.params.sessionId, request.body, expectedVersion(request)) }));
  router.delete("/analyzer/sessions/:sessionId", (request, response) => { analyzerService.removeSession(request.params.sessionId, expectedVersion(request)); response.status(204).end(); });
  router.get("/analyzer/sessions/:sessionId/media", (request, response) => response.json({ media: analyzerService.listSessionMedia(request.params.sessionId) }));
  router.post("/analyzer/sessions/:sessionId/media", (request, response) => response.status(201).json({ media: analyzerService.attachSessionMedia(request.params.sessionId, request.body) }));
  router.delete("/analyzer/sessions/:sessionId/media/:mediaId", (request, response) => { analyzerService.detachSessionMedia(request.params.sessionId, request.params.mediaId, expectedVersion(request)); response.status(204).end(); });
  router.get("/analyzer/sessions/:sessionId/state", (request, response) => response.json(analyzerService.getSessionState(request.params.sessionId)));
  router.get("/analyzer/sessions/:sessionId/reports", (request, response) => response.json({ reports: analyzerService.listReports(request.params.sessionId) }));
  router.get("/analyzer/sessions/:sessionId/reports/latest", (request, response) => response.json({ report: analyzerService.latestReport(request.params.sessionId) }));
  router.get("/analyzer/sessions/:sessionId/reports/:versionOrId", (request, response) => response.json({ report: analyzerService.getReportForSession(request.params.sessionId, request.params.versionOrId) }));
  router.post("/analyzer/sessions/:sessionId/reports", (request, response) => response.status(201).json({ report: analyzerService.appendReport(request.params.sessionId, request.body) }));
  router.get("/analyzer/reports/:reportId", (request, response) => response.json({ report: analyzerService.getReport(request.params.reportId) }));
  router.get("/analyzer/reports/:reportId/feedback", (request, response) => response.json({ feedback: analyzerService.feedbackForReport(request.params.reportId) }));
  router.post("/analyzer/reports/:reportId/feedback", (request, response) => response.status(201).json({ feedback: analyzerService.createFeedback(request.params.reportId, request.body) }));
  router.patch("/analyzer/feedback/:feedbackId", (request, response) => response.json({ feedback: analyzerService.updateFeedback(request.params.feedbackId, request.body, expectedVersion(request)) }));
  router.delete("/analyzer/feedback/:feedbackId", (request, response) => { analyzerService.removeFeedback(request.params.feedbackId, expectedVersion(request)); response.status(204).end(); });

  router.get("/goals", (request, response) => response.json({ goals: goalService.list() }));
  router.post("/goals", (request, response) => response.status(201).json({ goal: goalService.create(request.body) }));
  router.get("/goals/:goalId", (request, response) => response.json({ goal: goalService.get(request.params.goalId) }));
  router.patch("/goals/:goalId", (request, response) => response.json({ goal: goalService.update(request.params.goalId, request.body, expectedVersion(request)) }));
  router.delete("/goals/:goalId", (request, response) => { goalService.remove(request.params.goalId, expectedVersion(request)); response.status(204).end(); });
  router.get("/goals/:goalId/milestones", (request, response) => response.json({ milestones: goalService.listMilestones(request.params.goalId) }));
  router.post("/goals/:goalId/milestones", (request, response) => response.status(201).json({ milestone: goalService.createMilestone(request.params.goalId, request.body) }));
  router.get("/goals/:goalId/milestones/:milestoneId", (request, response) => response.json({ milestone: goalService.getMilestone(request.params.goalId, request.params.milestoneId) }));
  router.patch("/goals/:goalId/milestones/:milestoneId", (request, response) => response.json({ milestone: goalService.updateMilestone(request.params.goalId, request.params.milestoneId, request.body, expectedVersion(request)) }));
  router.delete("/goals/:goalId/milestones/:milestoneId", (request, response) => { goalService.removeMilestone(request.params.goalId, request.params.milestoneId, expectedVersion(request)); response.status(204).end(); });

  router.get("/habits", (request, response) => response.json({ habits: habitService.list() }));
  router.post("/habits", (request, response) => response.status(201).json({ habit: habitService.create(request.body) }));
  router.get("/habits/:habitId", (request, response) => response.json({ habit: habitService.get(request.params.habitId) }));
  router.patch("/habits/:habitId", (request, response) => response.json({ habit: habitService.update(request.params.habitId, request.body, expectedVersion(request)) }));
  router.delete("/habits/:habitId", (request, response) => { habitService.remove(request.params.habitId, expectedVersion(request)); response.status(204).end(); });
  router.get("/habits/:habitId/entries", (request, response) => response.json({ entries: habitService.listEntries(request.params.habitId, request.query.from, request.query.to) }));
  router.post("/habits/:habitId/entries", (request, response) => response.status(201).json({ entry: habitService.setEntry(request.params.habitId, request.body, request.body?.expectedVersion) }));
  router.get("/habits/:habitId/entries/:entryDate", (request, response) => response.json({ entry: habitService.getEntry(request.params.habitId, request.params.entryDate) }));
  router.patch("/habits/:habitId/entry-records/:entryId", (request, response) => response.json({ entry: habitService.updateEntry(request.params.habitId, request.params.entryId, request.body, expectedVersion(request)) }));
  router.delete("/habits/:habitId/entry-records/:entryId", (request, response) => { habitService.removeEntry(request.params.habitId, request.params.entryId, expectedVersion(request)); response.status(204).end(); });

  router.get("/reflections", (request, response) => response.json({ reflections: reflectionService.list() }));
  router.post("/reflections", (request, response) => response.status(201).json({ reflection: reflectionService.create(request.body) }));
  router.get("/reflections/:id", (request, response) => response.json({ reflection: reflectionService.get(request.params.id) }));
  router.patch("/reflections/:id", (request, response) => response.json({ reflection: reflectionService.update(request.params.id, request.body, expectedVersion(request)) }));
  router.delete("/reflections/:id", (request, response) => { reflectionService.remove(request.params.id, expectedVersion(request)); response.status(204).end(); });

  router.use((error, request, response, next) => {
    if (!error.scope) error.scope = "persistence";
    next(error);
  });

  router.persistenceServices = { accountService, tradeService, classificationService, mediaService, journalService, analyzerService, goalService, habitService, reflectionService };

  return router;
}

function parseUploadMetadata(value) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") throw badRequest("Screenshot metadata must be valid JSON.");
  try {
    const metadata = JSON.parse(value);
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("not an object");
    return metadata;
  } catch {
    throw badRequest("Screenshot metadata must be valid JSON.");
  }
}

function expectedVersion(request) {
  const body = request.body && typeof request.body === "object" ? request.body : {};
  const header = request.get("If-Match")?.replaceAll('"', "").trim();
  const value = body.expectedVersion ?? body.version ?? request.query.expectedVersion ?? header;
  if (value === undefined || value === null || value === "") {
    throw badRequest("expectedVersion is required for update and delete operations.");
  }
  return value;
}
