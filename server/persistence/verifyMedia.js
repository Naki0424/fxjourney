import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
import { createClassificationService } from "./services/classificationService.js";
import { createMediaService } from "./services/mediaService.js";
import { createMediaStorage } from "./mediaStorage.js";
import { createMediaUploadMiddleware, MAX_MEDIA_FILE_SIZE } from "./mediaUpload.js";
import { createId, nowUtc } from "./utils.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function expectStatus(operation, statusCode, description) {
  assert.throws(operation, (error) => error?.statusCode === statusCode, description);
}

function createApi(database, context, mediaStorage) {
  const app = express();
  app.use(express.json());
  app.use("/api", createPersistenceRouter({
    database,
    getContext: () => context,
    mediaStorage,
    uploadMiddleware: createMediaUploadMiddleware(),
  }));
  app.use((error, request, response, next) => {
    if (response.headersSent) return next(error);
    if (error?.code === "LIMIT_FILE_SIZE") return response.status(413).json({ error: "Screenshot must be 10 MB or smaller." });
    if (error?.message === "Please upload a PNG, JPG, or JPEG screenshot.") return response.status(400).json({ error: error.message });
    const status = [400, 404, 409].includes(Number(error?.statusCode)) ? Number(error.statusCode) : 500;
    return response.status(status).json({ error: status === 500 ? "Persistence request failed." : error.message });
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function request(server, method, requestPath, { body, headers = {}, binary = false } = {}) {
  const address = server.address();
  const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const requestInstance = http.request({
      hostname: address.address,
      port: address.port,
      path: requestPath,
      method,
      headers: {
        ...(payload && !headers["Content-Type"] ? { "Content-Type": "application/json" } : {}),
        ...(payload && !headers["Content-Length"] ? { "Content-Length": payload.length } : {}),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: binary ? responseBody : responseBody.length ? JSON.parse(responseBody.toString("utf8")) : null,
        });
      });
    });
    requestInstance.on("error", reject);
    if (payload) requestInstance.write(payload);
    requestInstance.end();
  });
}

function multipartBody({ metadata, file, filename, mimeType }) {
  const boundary = `----FXJourneyMedia${randomUUID()}`;
  const metadataPart = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n`);
  const fileHeader = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const end = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([metadataPart, fileHeader, file, end]), contentType: `multipart/form-data; boundary=${boundary}` };
}

function insertForeignTrade(database) {
  const userId = createId();
  const deviceId = createId();
  const accountId = createId();
  const tradeId = createId();
  const timestamp = nowUtc();
  insertUserProfile(database, { id: userId, displayName: "Foreign User", avatarMediaId: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1, originDeviceId: deviceId, lastModifiedByDeviceId: deviceId });
  insertDevice(database, { id: deviceId, userId, name: "Foreign Device", platform: "TEST", appVersion: null, createdAt: timestamp, lastSeenAt: timestamp, retiredAt: null });
  insertAccount(database, { id: accountId, userId, name: "Foreign Account", brokerName: null, accountType: null, currencyCode: "USD", currencyMinorDigits: 2, initialBalanceMinor: null, active: true, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, version: 1, originDeviceId: deviceId, lastModifiedByDeviceId: deviceId });
  database.prepare("INSERT INTO trades (id, userId, accountId, instrument, direction, status, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(tradeId, userId, accountId, "EURUSD", "BUY", "OPEN", timestamp, timestamp, deviceId, deviceId);
  return tradeId;
}

async function runVerification() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-media-"));
  const databasePath = path.join(temporaryDirectory, "media.db");
  const identityPath = path.join(temporaryDirectory, "local-identity.json");
  let database;
  let apiServer;

  try {
    database = openDatabase({ filename: databasePath, wal: false });
    runMigrations(database);
    const { bootstrapLocalInstallation } = await import("./services/bootstrapService.js");
    const context = bootstrapLocalInstallation({ database, identityPath });
    const classificationService = createClassificationService({ database, getContext: () => context });
    const mediaStorage = createMediaStorage({ rootDirectory: path.join(temporaryDirectory, "media") });
    const mediaService = createMediaService({ database, getContext: () => context, classificationService, mediaStorage });
    const folder = classificationService.createFolder({ name: "Verification Charts" });
    const category = classificationService.createCategory({ name: "Breakout" });
    const tag = classificationService.createTag({ name: "London" });
    const contextAccountId = createId();
    const accountTimestamp = nowUtc();
    insertAccount(database, { id: contextAccountId, userId: context.userId, name: "Media Account", brokerName: null, accountType: "DEMO", currencyCode: "USD", currencyMinorDigits: 2, initialBalanceMinor: null, active: true, createdAt: accountTimestamp, updatedAt: accountTimestamp, deletedAt: null, version: 1, originDeviceId: context.deviceId, lastModifiedByDeviceId: context.deviceId });
    const localTradeId = createId();
    database.prepare("INSERT INTO trades (id, userId, accountId, instrument, direction, status, createdAt, updatedAt, originDeviceId, lastModifiedByDeviceId) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(localTradeId, context.userId, contextAccountId, "EURUSD", "BUY", "OPEN", accountTimestamp, accountTimestamp, context.deviceId, context.deviceId);

    apiServer = await listen(createApi(database, context, mediaStorage));
    const multipart = multipartBody({
      metadata: { folderId: folder.id, categoryIds: [category.id], tagIds: [tag.id], tradeId: localTradeId, favorite: true, capturedAt: "2026-09-15T10:00:00.000Z" },
      file: PNG_1X1,
      filename: "EURUSD chart.png",
      mimeType: "image/png",
    });
    const uploadResponse = await request(apiServer, "POST", "/api/screenshots", { body: multipart.body, headers: { "Content-Type": multipart.contentType } });
    if (uploadResponse.status !== 201) throw new Error(`Initial screenshot upload failed: ${uploadResponse.status} ${JSON.stringify(uploadResponse.body)}`);
    assert.equal(uploadResponse.status, 201);
    const screenshot = uploadResponse.body.screenshot;
    const expectedChecksum = createHash("sha256").update(PNG_1X1).digest("hex");
    assert.equal(screenshot.originalFilename, "EURUSD chart.png");
    assert.equal(screenshot.mimeType, "image/png");
    assert.equal(screenshot.byteSize, PNG_1X1.length);
    assert.equal(screenshot.width, 1);
    assert.equal(screenshot.height, 1);
    assert.equal(screenshot.checksumSha256, expectedChecksum);
    assert.match(screenshot.storageKey, /^screenshots\/\d{4}\/\d{2}\/[0-9a-f-]+\.png$/);
    assert.equal(screenshot.storageKey.includes(".."), false);
    assert.equal(path.isAbsolute(screenshot.storageKey), false);
    assert.equal(screenshot.folderId, folder.id);
    assert.equal(screenshot.tradeId, localTradeId);
    assert.equal(screenshot.favorite, true);
    assert.equal(screenshot.tags[0].id, tag.id);
    assert.equal(screenshot.categories[0].id, category.id);
    assert.equal(mediaStorage.exists(screenshot.storageKey), true);
    assert.deepEqual(mediaStorage.read(screenshot.storageKey), PNG_1X1);

    const listResponse = await request(apiServer, "GET", "/api/screenshots");
    assert.equal(listResponse.status, 200);
    assert.equal(listResponse.body.screenshots.length, 1);
    const getResponse = await request(apiServer, "GET", `/api/screenshots/${screenshot.id}`);
    assert.equal(getResponse.status, 200);
    const contentResponse = await request(apiServer, "GET", `/api/screenshots/${screenshot.id}/content`, { binary: true });
    assert.equal(contentResponse.status, 200);
    assert.equal(contentResponse.headers["content-type"], "image/png");
    assert.deepEqual(contentResponse.body, PNG_1X1);

    const secondMultipart = multipartBody({ metadata: {}, file: PNG_1X1, filename: "same.png", mimeType: "image/png" });
    const secondUpload = await request(apiServer, "POST", "/api/screenshots", { body: secondMultipart.body, headers: { "Content-Type": secondMultipart.contentType } });
    assert.equal(secondUpload.status, 201);
    assert.equal(secondUpload.body.screenshot.checksumSha256, screenshot.checksumSha256);
    assert.notEqual(secondUpload.body.screenshot.id, screenshot.id);

    const updateResponse = await request(apiServer, "PATCH", `/api/screenshots/${screenshot.id}`, { body: { favorite: false, expectedVersion: 1 } });
    assert.equal(updateResponse.status, 200);
    assert.equal(updateResponse.body.screenshot.version, 2);
    assert.equal(updateResponse.body.screenshot.favorite, false);
    const staleResponse = await request(apiServer, "PATCH", `/api/screenshots/${screenshot.id}`, { body: { favorite: true, expectedVersion: 1 } });
    assert.equal(staleResponse.status, 409);

    const folderDelete = await request(apiServer, "DELETE", `/api/folders/${folder.id}`, { body: { expectedVersion: 1 } });
    assert.equal(folderDelete.status, 204);
    const afterFolderDelete = await request(apiServer, "GET", `/api/screenshots/${screenshot.id}`);
    assert.equal(afterFolderDelete.body.screenshot.folderId, null);
    assert.equal(mediaStorage.exists(screenshot.storageKey), true);

    const unsupportedMultipart = multipartBody({ metadata: {}, file: Buffer.from("not an image"), filename: "chart.gif", mimeType: "image/gif" });
    assert.equal((await request(apiServer, "POST", "/api/screenshots", { body: unsupportedMultipart.body, headers: { "Content-Type": unsupportedMultipart.contentType } })).status, 400);
    const malformedMultipart = multipartBody({ metadata: {}, file: Buffer.from("not a png"), filename: "chart.png", mimeType: "image/png" });
    assert.equal((await request(apiServer, "POST", "/api/screenshots", { body: malformedMultipart.body, headers: { "Content-Type": malformedMultipart.contentType } })).status, 400);
    const oversizedMultipart = multipartBody({ metadata: {}, file: Buffer.alloc(MAX_MEDIA_FILE_SIZE + 1), filename: "large.png", mimeType: "image/png" });
    assert.equal((await request(apiServer, "POST", "/api/screenshots", { body: oversizedMultipart.body, headers: { "Content-Type": oversizedMultipart.contentType } })).status, 413);

    expectStatus(() => mediaService.create({ originalFilename: "bad.png", mimeType: "image/png", byteSize: 1, storageKey: "../escape.png", checksumSha256: expectedChecksum, source: "SCREENSHOT" }), 400, "Path traversal storage key was accepted.");
    const foreignTradeId = insertForeignTrade(database);
    const beforeInvalidRelationship = fs.readdirSync(mediaStorage.rootDirectory, { recursive: true }).length;
    const invalidRelationshipMultipart = multipartBody({ metadata: { tradeId: foreignTradeId }, file: PNG_1X1, filename: "foreign.png", mimeType: "image/png" });
    assert.equal((await request(apiServer, "POST", "/api/screenshots", { body: invalidRelationshipMultipart.body, headers: { "Content-Type": invalidRelationshipMultipart.contentType } })).status, 404);
    const afterInvalidRelationship = fs.readdirSync(mediaStorage.rootDirectory, { recursive: true }).length;
    assert.equal(afterInvalidRelationship, beforeInvalidRelationship);

    const deleteResponse = await request(apiServer, "DELETE", `/api/screenshots/${screenshot.id}`, { body: { expectedVersion: afterFolderDelete.body.screenshot.version } });
    assert.equal(deleteResponse.status, 204);
    assert.equal((await request(apiServer, "GET", `/api/screenshots/${screenshot.id}`)).status, 404);
    assert.equal((await request(apiServer, "GET", "/api/screenshots")).body.screenshots.length, 1);
    assert.equal(mediaStorage.exists(screenshot.storageKey), true);
    assert.ok(database.prepare("SELECT deletedAt FROM media_assets WHERE id = ?").get(screenshot.id).deletedAt);

    return { temporaryDirectory, databasePath };
  } finally {
    if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
    if (database) closeDatabase(database);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  const result = await runVerification();
  console.log("Media verification passed: upload, storage, checksum, metadata, relationships, content serving, validation, concurrency, soft delete, and cleanup");
  console.log(`Temporary verification data cleaned: ${!fs.existsSync(result.temporaryDirectory)}`);
} catch (error) {
  console.error(`Media verification failed: ${error.message}`);
  process.exitCode = 1;
}
