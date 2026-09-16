import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { closeDatabase, openDatabase } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";
import { createPersistenceRouter } from "./routes.js";
import { findSyncPeer, markSyncPeerUsed } from "./syncPeerRepository.js";
import { createSyncTransportOrchestrator } from "./syncTransportClient.js";
import { parseAllowedSyncHosts } from "./syncEndpoints.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), override: true, quiet: true });

const args = parseArgs(process.argv.slice(2));
let database;

try {
  const peerDeviceId = args["peer-id"] || args.peer;
  if (!peerDeviceId) throw new Error("Usage: npm run sync:peer -- --peer-id <trusted-device-id>");
  database = openDatabase();
  runMigrations(database);
  const context = bootstrapLocalInstallation({ database });
  const persistenceRouter = createPersistenceRouter({ database, getContext: () => context });
  const syncService = persistenceRouter.persistenceServices.syncService;
  const peer = findSyncPeer(database, context.deviceId, peerDeviceId);
  if (!peer) throw new Error("The requested peer is not paired on this device.");

  const result = await createSyncTransportOrchestrator({
    database,
    getContext: () => context,
    syncService,
    identity: { ...context.auth, deviceId: context.deviceId },
    peerUrl: peer.endpointUrl,
    peerDeviceId: peer.peerDeviceId,
    allowedHosts: parseAllowedSyncHosts(),
  }).syncWithPeer();
  if (!result.ok) throw new Error(result.error || "The sync cycle could not be completed.");
  markSyncPeerUsed(database, context.deviceId, peerDeviceId, new Date().toISOString());
  console.log(JSON.stringify({
    ok: true,
    peerDeviceId,
    endpointUrl: peer.endpointUrl,
    pushed: summarizeStatuses(result.pushed),
    pulled: summarizeStatuses(result.pulled),
  }, null, 2));
} catch (error) {
  console.error(`Sync failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  closeDatabase(database);
}

function summarizeStatuses(result) {
  const statuses = Array.isArray(result?.lastStatuses) ? result.lastStatuses : [];
  const counts = {};
  for (const status of statuses) {
    const key = status?.status || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  }
  return {
    batches: result?.batches || 0,
    events: result?.eventsSent ?? result?.eventsReceived ?? 0,
    statuses: counts,
  };
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    parsed[key] = values[index + 1]?.startsWith("--") ? true : values[++index];
  }
  return parsed;
}
