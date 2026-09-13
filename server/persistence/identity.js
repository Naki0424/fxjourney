import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DEFAULT_DATABASE_PATH } from "../db/index.js";
import { isUuid } from "./utils.js";

const defaultIdentityPath = path.join(path.dirname(DEFAULT_DATABASE_PATH), "local-identity.json");

export function resolveIdentityPath(filename = process.env.FXJOURNEY_IDENTITY_PATH || defaultIdentityPath) {
  return filename === ":memory:" ? filename : path.resolve(filename);
}

export function readLocalIdentity(filename = process.env.FXJOURNEY_IDENTITY_PATH || defaultIdentityPath) {
  const identityPath = resolveIdentityPath(filename);
  try {
    const identity = JSON.parse(fs.readFileSync(identityPath, "utf8"));
    if (!isUuid(identity?.deviceId) || !isUuid(identity?.userId)) return null;
    return { deviceId: identity.deviceId, userId: identity.userId };
  } catch {
    return null;
  }
}

export function writeLocalIdentity(identity, filename = process.env.FXJOURNEY_IDENTITY_PATH || defaultIdentityPath) {
  const identityPath = resolveIdentityPath(filename);
  fs.mkdirSync(path.dirname(identityPath), { recursive: true });
  const temporaryPath = `${identityPath}.${process.pid}.${randomUUID()}.tmp`;
  const contents = `${JSON.stringify(identity, null, 2)}\n`;
  try {
    fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    fs.renameSync(temporaryPath, identityPath);
    try {
      fs.chmodSync(identityPath, 0o600);
    } catch {
      // Windows may not expose POSIX file modes; the file contains no secrets.
    }
  } finally {
    if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
  }
  return identityPath;
}
