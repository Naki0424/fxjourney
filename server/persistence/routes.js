import express from "express";
import { badRequest } from "./errors.js";
import { createAccountService } from "./services/accountService.js";
import { createTradeService } from "./services/tradeService.js";

export function createPersistenceRouter({ database, getContext }) {
  const router = express.Router();
  const accountService = createAccountService({ database, getContext });
  const tradeService = createTradeService({ database, getContext });

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

  router.use((error, request, response, next) => {
    if (!error.scope) error.scope = "persistence";
    next(error);
  });

  return router;
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
