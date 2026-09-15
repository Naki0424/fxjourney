import { createHash, randomUUID } from "node:crypto";

export function canonicalJson(value) {
  return JSON.stringify(sortJsonValue(value, "$"));
}

export function payloadHash(payload) {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}

function sortJsonValue(value, path) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => sortJsonValue(item, `${path}[${index}]`));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJsonValue(value[key], `${path}.${key}`)]),
    );
  }
  throw new Error(`${path} contains a non-JSON value.`);
}

export function allocateOriginSequence(database, deviceId) {
  database.prepare(`
    INSERT OR IGNORE INTO sync_device_sequences (deviceId, nextOriginSeq)
    VALUES (?, COALESCE((
      SELECT MAX(originSeq) + 1 FROM sync_changes WHERE originDeviceId = ?
    ), 1))
  `).run(deviceId, deviceId);

  const current = database.prepare(
    "SELECT nextOriginSeq FROM sync_device_sequences WHERE deviceId = ?",
  ).get(deviceId);
  if (!current) throw new Error("The local device sequence is not registered.");

  database.prepare(
    "UPDATE sync_device_sequences SET nextOriginSeq = nextOriginSeq + 1 WHERE deviceId = ?",
  ).run(deviceId);
  return current.nextOriginSeq;
}

export function insertSyncChange(database, event, receivedFromDeviceId = null) {
  database.prepare(`
    INSERT INTO sync_changes (
      changeId, originDeviceId, originSeq, receivedFromDeviceId,
      entityType, entityId, operation, baseVersion, newVersion,
      changedFieldsJson, payloadJson, createdAt, payloadHash,
      dependenciesJson, protocolVersion, payloadSchemaVersion
    ) VALUES (
      @changeId, @originDeviceId, @originSeq, @receivedFromDeviceId,
      @entityType, @entityId, @operation, @baseVersion, @newVersion,
      @changedFieldsJson, @payloadJson, @createdAt, @payloadHash,
      @dependenciesJson, @protocolVersion, @payloadSchemaVersion
    )
  `).run({
    ...event,
    receivedFromDeviceId,
    newVersion: event.resultingVersion,
    changedFieldsJson: canonicalJson(event.changedFields),
    payloadJson: canonicalJson(event.payload),
    dependenciesJson: canonicalJson(event.dependencies),
  });
  return findSyncChangeById(database, event.changeId);
}

export function findSyncChangeById(database, changeId) {
  return mapChange(database.prepare("SELECT * FROM sync_changes WHERE changeId = ?").get(changeId));
}

export function findSyncChangeByOriginSequence(database, originDeviceId, originSeq) {
  return mapChange(database.prepare(
    "SELECT * FROM sync_changes WHERE originDeviceId = ? AND originSeq = ?",
  ).get(originDeviceId, originSeq));
}

export function findSyncChangesForEntityVersion(database, entityType, entityId, version) {
  return mapChange(database.prepare(`
    SELECT * FROM sync_changes
    WHERE entityType = ? AND entityId = ? AND newVersion = ?
    ORDER BY seq DESC
    LIMIT 1
  `).get(entityType, entityId, version));
}

export function listSyncChangesAfter(database, originDeviceId, originSeq, limit) {
  return database.prepare(`
    SELECT * FROM sync_changes
    WHERE originDeviceId = ? AND originSeq > ?
    ORDER BY originSeq ASC
    LIMIT ?
  `).all(originDeviceId, originSeq, limit).map(mapChange);
}

export function findSyncReceipt(database, changeId, localDeviceId) {
  return database.prepare(`
    SELECT * FROM sync_change_receipts
    WHERE changeId = ? AND localDeviceId = ?
  `).get(changeId, localDeviceId) || null;
}

export function saveSyncReceipt(database, receipt) {
  database.prepare(`
    INSERT INTO sync_change_receipts (
      changeId, localDeviceId, remoteDeviceId, status,
      receivedAt, processedAt, errorMessage
    ) VALUES (
      @changeId, @localDeviceId, @remoteDeviceId, @status,
      @receivedAt, @processedAt, @errorMessage
    )
    ON CONFLICT(changeId) DO UPDATE SET
      localDeviceId = excluded.localDeviceId,
      remoteDeviceId = excluded.remoteDeviceId,
      status = excluded.status,
      receivedAt = excluded.receivedAt,
      processedAt = excluded.processedAt,
      errorMessage = excluded.errorMessage
  `).run(receipt);
  return findSyncReceipt(database, receipt.changeId, receipt.localDeviceId);
}

export function insertPendingSyncChange(database, pending) {
  database.prepare(`
    INSERT INTO sync_pending_changes (
      changeId, localDeviceId, remoteDeviceId,
      dependencyEntityType, dependencyEntityId,
      queuedAt, lastAttemptedAt
    ) VALUES (
      @changeId, @localDeviceId, @remoteDeviceId,
      @dependencyEntityType, @dependencyEntityId,
      @queuedAt, @lastAttemptedAt
    )
    ON CONFLICT(changeId) DO UPDATE SET
      lastAttemptedAt = excluded.lastAttemptedAt
  `).run(pending);
}

export function removePendingSyncChange(database, changeId) {
  database.prepare("DELETE FROM sync_pending_changes WHERE changeId = ?").run(changeId);
}

export function listPendingSyncChanges(database, localDeviceId, remoteDeviceId) {
  return database.prepare(`
    SELECT pending.*, changes.originDeviceId, changes.originSeq
    FROM sync_pending_changes AS pending
    JOIN sync_changes AS changes ON changes.changeId = pending.changeId
    WHERE pending.localDeviceId = ? AND pending.remoteDeviceId = ?
    ORDER BY changes.originSeq ASC, changes.changeId ASC
  `).all(localDeviceId, remoteDeviceId);
}

export function ensureSyncState(database, localDeviceId, remoteDeviceId) {
  const existing = findSyncState(database, localDeviceId, remoteDeviceId);
  if (existing) return existing;
  database.prepare(`
    INSERT INTO sync_state (
      id, localDeviceId, remoteDeviceId, lastReceivedRemoteSeq,
      lastSentLocalSeq, status, lastError
    ) VALUES (?, ?, ?, 0, 0, 'IDLE', NULL)
  `).run(randomUUID(), localDeviceId, remoteDeviceId);
  return findSyncState(database, localDeviceId, remoteDeviceId);
}

export function findSyncState(database, localDeviceId, remoteDeviceId) {
  return database.prepare(`
    SELECT * FROM sync_state
    WHERE localDeviceId = ? AND remoteDeviceId = ?
  `).get(localDeviceId, remoteDeviceId) || null;
}

export function updateSyncState(database, localDeviceId, remoteDeviceId, fields) {
  const assignments = [];
  const values = [];
  for (const field of [
    "lastReceivedRemoteSeq",
    "lastSentLocalSeq",
    "lastSyncStartedAt",
    "lastSyncCompletedAt",
    "status",
    "lastError",
  ]) {
    if (Object.prototype.hasOwnProperty.call(fields, field)) {
      assignments.push(`${field} = ?`);
      values.push(fields[field]);
    }
  }
  if (!assignments.length) return findSyncState(database, localDeviceId, remoteDeviceId);
  values.push(localDeviceId, remoteDeviceId);
  database.prepare(`
    UPDATE sync_state SET ${assignments.join(", ")}
    WHERE localDeviceId = ? AND remoteDeviceId = ?
  `).run(...values);
  return findSyncState(database, localDeviceId, remoteDeviceId);
}

export function advanceReceivedCursor(database, localDeviceId, remoteDeviceId) {
  const state = ensureSyncState(database, localDeviceId, remoteDeviceId);
  let cursor = Number(state.lastReceivedRemoteSeq || 0);

  while (true) {
    const next = findSyncChangeByOriginSequence(database, remoteDeviceId, cursor + 1);
    if (!next) break;
    const receipt = findSyncReceipt(database, next.changeId, localDeviceId);
    if (!receipt || !["APPLIED", "CONFLICT"].includes(receipt.status)) break;
    cursor = next.originSeq;
  }

  if (cursor !== Number(state.lastReceivedRemoteSeq || 0)) {
    updateSyncState(database, localDeviceId, remoteDeviceId, {
      lastReceivedRemoteSeq: cursor,
    });
  }
  return cursor;
}

export function insertSyncConflict(database, conflict) {
  database.prepare(`
    INSERT INTO sync_conflicts (
      id, entityType, entityId, conflictType, fieldName,
      localDeviceId, remoteDeviceId, baseVersion,
      localPayloadJson, remotePayloadJson, detectedAt,
      status, resolution, resolvedAt, localChangeId,
      remoteChangeId, basePayloadJson, resolvedByDeviceId
    ) VALUES (
      @id, @entityType, @entityId, @conflictType, @fieldName,
      @localDeviceId, @remoteDeviceId, @baseVersion,
      @localPayloadJson, @remotePayloadJson, @detectedAt,
      'UNRESOLVED', NULL, NULL, @localChangeId,
      @remoteChangeId, @basePayloadJson, NULL
    )
  `).run({
    ...conflict,
    localPayloadJson: canonicalJson(conflict.localPayload),
    remotePayloadJson: canonicalJson(conflict.remotePayload),
    basePayloadJson: conflict.basePayload === null || conflict.basePayload === undefined
      ? null
      : canonicalJson(conflict.basePayload),
  });
  return database.prepare("SELECT * FROM sync_conflicts WHERE id = ?").get(conflict.id);
}

function mapChange(row) {
  if (!row) return null;
  const { newVersion, ...change } = row;
  return {
    ...change,
    resultingVersion: newVersion,
    changedFields: parseJson(change.changedFieldsJson, []),
    payload: parseJson(change.payloadJson, null),
    dependencies: parseJson(change.dependenciesJson, []),
  };
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
