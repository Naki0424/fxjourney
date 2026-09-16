import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { closeDatabase, openDatabase } from "../db/index.js";
import { runMigrations } from "../db/migrate.js";
import { resolveIdentityPath } from "./identity.js";
import { acceptPairing, PairingClientError } from "./pairingClient.js";
import { createPairingInvitation } from "./pairingService.js";
import { bootstrapLocalInstallation } from "./services/bootstrapService.js";
import { parseAllowedSyncHosts } from "./syncEndpoints.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)), override: true, quiet: true });

const [command, ...values] = process.argv.slice(2);
const args = parseArgs(values);
let database;

try {
  database = openDatabase();
  runMigrations(database);
  const context = bootstrapLocalInstallation({ database });

  if (command === "create") {
    const minutes = args["expires-minutes"] === undefined ? 10 : Number(args["expires-minutes"]);
    if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > 1440) {
      throw new Error("--expires-minutes must be an integer between 1 and 1440.");
    }
    const invitation = createPairingInvitation({
      database,
      getContext: () => context,
      expiresInMs: minutes * 60 * 1000,
    });
    console.log(JSON.stringify(invitation, null, 2));
  } else if (command === "accept") {
    for (const name of ["peer", "token", "owner-fingerprint", "local-endpoint"]) {
      if (!args[name] || typeof args[name] !== "string") throw new Error(`Usage: npm run pairing -- accept --peer <url> --token <token> --owner-fingerprint <fingerprint> --local-endpoint <url>`);
    }
    const result = await acceptPairing({
      database,
      context,
      identityPath: resolveIdentityPath(),
      peerUrl: args.peer,
      token: args.token,
      ownerFingerprint: args["owner-fingerprint"],
      localEndpoint: args["local-endpoint"],
      allowedHosts: parseAllowedSyncHosts(),
    });
    console.log(JSON.stringify({
      ok: true,
      deviceId: result.adoption.deviceId,
      workspaceId: result.adoption.workspaceId,
      ownerDeviceId: result.adoption.ownerDeviceId,
      ownerFingerprint: result.adoption.ownerFingerprint,
      endpointUrl: result.adoption.endpointUrl,
      completedAt: result.completion.completedAt,
    }, null, 2));
  } else {
    throw new Error("Usage: npm run pairing -- <create|accept> [options]");
  }
} catch (error) {
  const code = error instanceof PairingClientError ? `${error.code}: ` : "";
  console.error(`Pairing failed: ${code}${error.message}`);
  process.exitCode = 1;
} finally {
  closeDatabase(database);
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
