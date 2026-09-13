import { randomUUID } from "node:crypto";
import { badRequest, internalPersistenceError } from "./errors.js";

export const DECIMAL_STRING_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function createId() {
  return randomUUID();
}

export function nowUtc() {
  return new Date().toISOString();
}

export function withTransaction(database, operation) {
  return database.transaction(operation)();
}

export function assertRequestObject(value, message = "Request body must be a JSON object.") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badRequest(message);
  }
  return value;
}

export function requiredText(value, field, { maxLength = 500 } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(`${field} is required.`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw badRequest(`${field} is too long.`);
  }
  return text;
}

export function optionalText(value, field, { maxLength = 500 } = {}) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string or null.`);
  }
  const text = value.trim();
  if (text.length > maxLength) {
    throw badRequest(`${field} is too long.`);
  }
  return text || null;
}

export function enumValue(value, field, allowed, { defaultValue } = {}) {
  const candidate = value === undefined && defaultValue !== undefined ? defaultValue : value;
  if (typeof candidate !== "string" || !allowed.has(candidate)) {
    throw badRequest(`${field} must be one of: ${[...allowed].join(", ")}.`);
  }
  return candidate;
}

export function booleanValue(value, field, { defaultValue } = {}) {
  const candidate = value === undefined && defaultValue !== undefined ? defaultValue : value;
  if (typeof candidate !== "boolean") {
    throw badRequest(`${field} must be a boolean.`);
  }
  return candidate;
}

export function integerValue(value, field, { nullable = true, min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") {
    if (nullable) return null;
    throw badRequest(`${field} is required.`);
  }

  let number = value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    number = Number(value.trim());
  }
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw badRequest(`${field} must be a safe integer between ${min} and ${max}.`);
  }
  return number;
}

export function decimalString(value, field, { nullable = true, positive = false } = {}) {
  if (value === undefined || value === null || value === "") {
    if (nullable) return null;
    throw badRequest(`${field} is required.`);
  }
  if (typeof value !== "string" || !DECIMAL_STRING_PATTERN.test(value.trim())) {
    throw badRequest(`${field} must be a canonical decimal string.`);
  }
  if (positive && /^0(?:\.0+)?$/.test(value.trim())) {
    throw badRequest(`${field} must be greater than zero.`);
  }
  return value.trim();
}

export function timestampValue(value, field, { nullable = true } = {}) {
  if (value === undefined || value === null || value === "") {
    if (nullable) return null;
    throw badRequest(`${field} is required.`);
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw badRequest(`${field} must be a valid timestamp.`);
  }
  return new Date(value).toISOString();
}

export function jsonValue(value, field, { nullable = true } = {}) {
  if (value === undefined || value === null) {
    if (nullable) return null;
    throw badRequest(`${field} is required.`);
  }
  try {
    return JSON.stringify(sortJsonValue(value, field));
  } catch (error) {
    if (error?.statusCode) throw error;
    throw badRequest(`${field} must contain valid JSON data.`);
  }
}

export function parseJsonColumn(value, field) {
  if (value === undefined || value === null || value === "") return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    throw internalPersistenceError(`Stored ${field} JSON is invalid.`, error);
  }
}

export function parsePositiveVersion(value, field = "expectedVersion") {
  return integerValue(value, field, { nullable: false, min: 1 });
}

export function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function sortJsonValue(value, field) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw badRequest(`${field} must contain finite JSON numbers.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => sortJsonValue(item, field));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key], field)]),
    );
  }
  throw badRequest(`${field} must contain JSON-compatible values.`);
}
