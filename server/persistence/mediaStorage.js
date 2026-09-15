import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_DATABASE_PATH } from "../db/index.js";
import { badRequest } from "./errors.js";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

export const DEFAULT_MEDIA_DIRECTORY = path.join(path.dirname(DEFAULT_DATABASE_PATH), "media");

export function portableStorageKey(value, field = "storageKey") {
  if (typeof value !== "string" || !value.trim()) throw badRequest(`${field} is required.`);
  const key = value.trim().replaceAll("\\", "/");
  if (
    key.includes("\0")
    || key.startsWith("/")
    || /^[A-Za-z]:\//.test(key)
    || key.split("/").includes("..")
  ) {
    throw badRequest(`${field} must be a relative portable storage key.`);
  }
  return key;
}

function normalizedMimeType(value) {
  const mimeType = String(value || "").trim().toLowerCase();
  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

function hasPngSignature(buffer) {
  return buffer.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), extension: "png" };
}

function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (marker === 0xda || marker === 0x00) break;
    if (offset + 1 >= buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (JPEG_SOF_MARKERS.has(marker) && segmentLength >= 7) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
        extension: "jpg",
      };
    }
    offset += segmentLength;
  }
  return null;
}

export function inspectImageBuffer(buffer, { mimeType, originalFilename } = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw badRequest("The uploaded image is empty.");
  const normalized = normalizedMimeType(mimeType);
  const filename = path.basename(String(originalFilename || "")).replace(/[\u0000-\u001f\u007f]/g, "_").trim();
  if (!/\.(png|jpe?g)$/i.test(filename)) {
    throw badRequest("Screenshot filename must use a PNG, JPG, or JPEG extension.");
  }

  const metadata = hasPngSignature(buffer) ? pngDimensions(buffer) : jpegDimensions(buffer);
  if (!metadata) throw badRequest("The uploaded file is not a readable PNG or JPEG image.");
  const detectedMimeType = metadata.extension === "png" ? "image/png" : "image/jpeg";
  if (normalized !== detectedMimeType) throw badRequest("The uploaded file type does not match its image contents.");
  if (!metadata.width || !metadata.height) throw badRequest("The uploaded image dimensions could not be determined.");

  return {
    ...metadata,
    mimeType: detectedMimeType,
    originalFilename: filename,
    checksumSha256: createHash("sha256").update(buffer).digest("hex"),
  };
}

export function createMediaStorage({ rootDirectory = DEFAULT_MEDIA_DIRECTORY } = {}) {
  const root = path.resolve(rootDirectory);

  function resolvePath(storageKey) {
    const key = portableStorageKey(storageKey);
    const absolute = path.resolve(root, ...key.split("/"));
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
      throw badRequest("storageKey resolves outside the media storage directory.");
    }
    return absolute;
  }

  function store({ buffer, storageKey }) {
    const absolute = resolvePath(storageKey);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    const temporaryPath = `${absolute}.${process.pid}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, buffer, { flag: "wx" });
      fs.renameSync(temporaryPath, absolute);
    } catch (error) {
      try { fs.rmSync(temporaryPath, { force: true }); } catch { /* best effort cleanup */ }
      throw error;
    }
    return {
      storageKey: portableStorageKey(storageKey),
      byteSize: buffer.length,
      checksumSha256: createHash("sha256").update(buffer).digest("hex"),
    };
  }

  function read(storageKey) {
    try {
      return fs.readFileSync(resolvePath(storageKey));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  function exists(storageKey) {
    try {
      return fs.statSync(resolvePath(storageKey)).isFile();
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  function remove(storageKey) {
    fs.rmSync(resolvePath(storageKey), { force: true });
  }

  function archive(storageKey) {
    return { storageKey: portableStorageKey(storageKey), preserved: exists(storageKey) };
  }

  return { rootDirectory: root, store, read, exists, remove, archive };
}
