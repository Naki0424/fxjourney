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
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";
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
    if (response.headersSent) {
      next(error);
      return;
    }
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
      response.on("end", () => {
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: responseBody ? JSON.parse(responseBody) : null,
        });
      });
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function runVerification() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "fxjourney-persistence-"));
  const databasePath = path.join(temporaryDirectory, "persistence.db");
  const identityPath = path.join(temporaryDirectory, "local-identity.json");
  let database;
  let apiServer;

  try {
    database = openDatabase({ filename: databasePath, wal: false });
    const migration = runMigrations(database);
    assert.deepEqual(migration.applied, ["001", "002", "003"]);

    const firstContext = bootstrapLocalInstallation({ database, identityPath });
    const secondContext = bootstrapLocalInstallation({ database, identityPath });
    assert.equal(firstContext.deviceId, secondContext.deviceId, "Device bootstrap generated a new ID.");
    assert.equal(firstContext.userId, secondContext.userId, "User bootstrap generated a new ID.");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM devices").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM user_profiles").get().count, 1);
    assert.equal(fs.existsSync(identityPath), true, "Local identity file was not created.");

    const context = firstContext;
    const accountService = createAccountService({ database, getContext: () => context });
    const tradeService = createTradeService({ database, getContext: () => context });

    const account = accountService.create({
      name: "Primary USD",
      brokerName: "Test Broker",
      accountType: "DEMO",
      currencyCode: "USD",
      currencyMinorDigits: 2,
      initialBalanceMinor: 123456789,
    });
    assert.equal(account.active, true);
    assert.equal(accountService.get(account.id).initialBalanceMinor, 123456789);
    const updatedAccount = accountService.update(account.id, { name: "Primary Updated" }, 1);
    assert.equal(updatedAccount.version, 2);
    assert.equal(updatedAccount.originDeviceId, context.deviceId);
    assert.equal(updatedAccount.lastModifiedByDeviceId, context.deviceId);
    expectStatus(
      () => accountService.update(account.id, { name: "Stale" }, 1),
      409,
      "Stale account update was not rejected.",
    );

    const openedAt = "2026-09-10T12:00:00.000Z";
    const trade = tradeService.create({
      accountId: account.id,
      instrument: "EURUSD",
      direction: "BUY",
      status: "OPEN",
      openedAt,
      entryPrice: "1.084370000",
      stopLossPrice: "1.080000000",
      quantityLots: "0.0100",
      riskPercent: "0.1250",
      takeProfitTargets: [{ label: "TP1", price: "1.090000000" }],
      confluence: { trend: "bullish", level: "1.08437" },
      tradePlan: { trigger: "breakout" },
      emotions: { before: "calm" },
      review: null,
    });
    assert.equal(tradeService.get(trade.id).entryPrice, "1.084370000");
    assert.equal(tradeService.get(trade.id).quantityLots, "0.0100");
    assert.equal(tradeService.get(trade.id).takeProfitTargets[0].price, "1.090000000");
    const rawTrade = database.prepare("SELECT entryPrice, quantityLots, takeProfitTargetsJson FROM trades WHERE id = ?").get(trade.id);
    assert.equal(rawTrade.entryPrice, "1.084370000");
    assert.equal(rawTrade.quantityLots, "0.0100");
    assert.equal(JSON.parse(rawTrade.takeProfitTargetsJson)[0].price, "1.090000000");
    assert.equal(tradeService.list({ instrument: "EURUSD", direction: "BUY" }).length, 1);

    const closedTrade = tradeService.update(trade.id, {
      status: "CLOSED",
      outcome: "WIN",
      closedAt: "2026-09-10T13:00:00.000Z",
      exitPrice: "1.090000000",
      notes: "Closed for verification",
    }, 1);
    assert.equal(closedTrade.version, 2);
    assert.equal(closedTrade.originDeviceId, context.deviceId);
    assert.equal(closedTrade.lastModifiedByDeviceId, context.deviceId);
    expectStatus(
      () => tradeService.update(trade.id, { notes: "Stale" }, 1),
      409,
      "Stale trade update was not rejected.",
    );
    tradeService.remove(trade.id, 2);
    assert.equal(tradeService.list({ instrument: "EURUSD" }).length, 0);
    expectStatus(
      () => tradeService.create({ accountId: account.id, instrument: "EURUSD", direction: "INVALID" }),
      400,
      "Invalid trade direction was accepted.",
    );
    expectStatus(
      () => tradeService.create({
        accountId: account.id,
        instrument: "EURUSD",
        direction: "SELL",
        status: "CLOSED",
        openedAt: "2026-09-11T12:00:00.000Z",
        closedAt: "2026-09-11T11:00:00.000Z",
      }),
      400,
      "closedAt before openedAt was accepted.",
    );
    expectStatus(
      () => accountService.update(account.id, { currencyCode: "EUR" }, 2),
      409,
      "Account currency changed after a trade existed.",
    );

    const otherUserId = createId();
    const otherDeviceId = createId();
    const otherTimestamp = nowUtc();
    insertUserProfile(database, {
      id: otherUserId,
      displayName: "Other User",
      avatarMediaId: null,
      createdAt: otherTimestamp,
      updatedAt: otherTimestamp,
      deletedAt: null,
      version: 1,
      originDeviceId: otherDeviceId,
      lastModifiedByDeviceId: otherDeviceId,
    });
    insertDevice(database, {
      id: otherDeviceId,
      userId: otherUserId,
      name: "Other Device",
      platform: "TEST",
      appVersion: null,
      createdAt: otherTimestamp,
      lastSeenAt: otherTimestamp,
      retiredAt: null,
    });
    const otherAccountId = createId();
    insertAccount(database, {
      id: otherAccountId,
      userId: otherUserId,
      name: "Other Account",
      brokerName: null,
      accountType: null,
      currencyCode: "USD",
      currencyMinorDigits: 2,
      initialBalanceMinor: null,
      active: true,
      createdAt: otherTimestamp,
      updatedAt: otherTimestamp,
      deletedAt: null,
      version: 1,
      originDeviceId: otherDeviceId,
      lastModifiedByDeviceId: otherDeviceId,
    });
    expectStatus(
      () => tradeService.create({ accountId: otherAccountId, instrument: "USDJPY", direction: "BUY" }),
      404,
      "Trade creation crossed account ownership.",
    );

    accountService.remove(account.id, 2);
    assert.equal(accountService.list().some((item) => item.id === account.id), false);

    const apiApp = createApi(database, context);
    apiServer = await listen(apiApp);
    const bootstrapResponse = await requestJson(apiServer, "GET", "/api/bootstrap");
    assert.equal(bootstrapResponse.status, 200);
    assert.equal(bootstrapResponse.body.device.id, context.deviceId);
    assert.equal(bootstrapResponse.body.userProfile.id, context.userId);

    const accountResponse = await requestJson(apiServer, "POST", "/api/accounts", {
      name: "API Account",
      currencyCode: "GBP",
      currencyMinorDigits: 2,
      initialBalanceMinor: 50000,
    });
    assert.equal(accountResponse.status, 201);
    const apiAccount = accountResponse.body.account;
    assert.equal(apiAccount.version, 1);
    assert.equal((await requestJson(apiServer, "GET", `/api/accounts/${apiAccount.id}`)).status, 200);
    const apiAccountUpdate = await requestJson(apiServer, "PATCH", `/api/accounts/${apiAccount.id}`, {
      name: "API Account Updated",
      expectedVersion: 1,
    });
    assert.equal(apiAccountUpdate.status, 200);
    assert.equal(apiAccountUpdate.body.account.version, 2);
    assert.equal((await requestJson(apiServer, "PATCH", `/api/accounts/${apiAccount.id}`, { name: "Stale", expectedVersion: 1 })).status, 409);

    const apiTradeResponse = await requestJson(apiServer, "POST", "/api/trades", {
      accountId: apiAccount.id,
      instrument: "GBPUSD",
      direction: "SELL",
      status: "OPEN",
      openedAt,
      entryPrice: "1.25000",
    });
    assert.equal(apiTradeResponse.status, 201);
    const apiTrade = apiTradeResponse.body.trade;
    assert.equal((await requestJson(apiServer, "GET", "/api/trades?instrument=GBPUSD")).body.trades.length, 1);
    const apiTradeUpdate = await requestJson(apiServer, "PATCH", `/api/trades/${apiTrade.id}`, { notes: "API update", expectedVersion: 1 });
    assert.equal(apiTradeUpdate.status, 200);
    assert.equal(apiTradeUpdate.body.trade.version, 2);
    assert.equal((await requestJson(apiServer, "PATCH", `/api/trades/${apiTrade.id}`, { notes: "Stale", expectedVersion: 1 })).status, 409);
    assert.equal((await requestJson(apiServer, "DELETE", `/api/trades/${apiTrade.id}`, undefined, { "If-Match": '"2"' })).status, 204);
    assert.equal((await requestJson(apiServer, "GET", `/api/trades/${apiTrade.id}`)).status, 404);
    assert.equal((await requestJson(apiServer, "DELETE", `/api/accounts/${apiAccount.id}`, undefined, { "If-Match": '"2"' })).status, 204);
    assert.equal((await requestJson(apiServer, "GET", `/api/accounts/${apiAccount.id}`)).status, 404);
    assert.equal((await requestJson(apiServer, "GET", "/api/accounts/missing-account")).status, 404);
    assert.equal((await requestJson(apiServer, "POST", "/api/accounts", { name: "Invalid" })).status, 400);

    return {
      migration,
      temporaryDirectory,
      databasePath,
    };
  } finally {
    if (apiServer) await new Promise((resolve) => apiServer.close(resolve));
    if (database) closeDatabase(database);
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

try {
  const result = await runVerification();
  console.log(`Persistence verification passed: temporary DB, device/user bootstrap, account/trade services, API CRUD, precision, ownership, lifecycle, and optimistic concurrency`);
  console.log(`Temporary verification data cleaned: ${!fs.existsSync(result.temporaryDirectory)}`);
} catch (error) {
  console.error(`Persistence verification failed: ${error.message}`);
  process.exitCode = 1;
}
