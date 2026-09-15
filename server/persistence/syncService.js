import { findDeviceById } from "./repositories/deviceRepository.js";
import {
  applyAccountCreate,
  applyAccountSnapshotToDatabase,
  applyTradeCreate,
  applyTradeSnapshotToDatabase,
  canonicalSnapshot,
  changedFields,
  dependenciesFor,
  findEntity,
  SYNC_OPERATIONS,
  SYNC_PAYLOAD_SCHEMA_VERSION,
  SYNC_PROTOCOL_VERSION,
  SYNC_ENTITY_TYPES,
  SyncValidationError,
  validateSnapshot,
} from "./syncAdapters.js";
import {
  advanceReceivedCursor,
  allocateOriginSequence,
  canonicalJson,
  ensureSyncState,
  findSyncChangeById,
  findSyncChangeByOriginSequence,
  findSyncChangesForEntityVersion,
  findSyncReceipt,
  insertPendingSyncChange,
  insertSyncChange,
  insertSyncConflict,
  listPendingSyncChanges,
  listSyncChangesAfter,
  removePendingSyncChange,
  saveSyncReceipt,
  updateSyncState,
  payloadHash,
} from "./syncRepository.js";
import { createId, nowUtc } from "./utils.js";

const MAX_EXPORT_LIMIT = 100;
export function createSyncService({ database, getContext, eventWriter = insertSyncChange, logger } = {}) {
  const log = logger || ((label, details) => {
    if (process.env.NODE_ENV !== "production") console.debug(`[sync][dev] ${label}`, details);
  });

  function context() {
    return getContext();
  }

  function recordLocalMutation({ entityType, operation, before = null, after }) {
    if (!database.inTransaction) {
      throw new Error("Sync event capture must run inside the domain transaction.");
    }
    const local = context();
    const payload = canonicalSnapshot(entityType, after);
    validateSnapshot(entityType, payload);
    if (payload.userId !== local.userId) throw new SyncValidationError("Local sync payload is outside the active workspace.");
    const resultingVersion = payload.version;
    // CREATE starts at version 1 with no base. UPDATE and DELETE carry the
    // version observed before the local mutation and advance it by one.
    const baseVersion = operation === "CREATE" ? null : before?.version;
    if (operation !== "CREATE" && !Number.isSafeInteger(baseVersion)) {
      throw new Error("A mutable sync mutation requires a base version.");
    }
    const event = {
      changeId: createId(),
      originDeviceId: local.deviceId,
      originSeq: allocateOriginSequence(database, local.deviceId),
      entityType,
      entityId: payload.id,
      operation,
      baseVersion,
      resultingVersion,
      payload,
      changedFields: changedFields(entityType, before, payload, operation),
      payloadHash: payloadHash(payload),
      dependencies: dependenciesFor(entityType, payload),
      createdAt: after.updatedAt || nowUtc(),
      protocolVersion: SYNC_PROTOCOL_VERSION,
      payloadSchemaVersion: SYNC_PAYLOAD_SCHEMA_VERSION,
    };
    validateEvent(event, local.userId);
    eventWriter(database, event);
    log("local mutation captured", eventSummary(event, "LOCAL"));
    return event;
  }

  function getChangesAfter(originDeviceId, cursor = 0, limit = 100) {
    const local = context();
    const origin = findDeviceById(database, originDeviceId);
    if (!origin || origin.userId !== local.userId) {
      throw new SyncValidationError("The requested change origin is outside the active workspace.");
    }
    const normalizedCursor = positiveCursor(cursor);
    const normalizedLimit = Math.min(MAX_EXPORT_LIMIT, positiveLimit(limit));
    const events = listSyncChangesAfter(database, originDeviceId, normalizedCursor, normalizedLimit);
    return {
      events: events.map(toEventEnvelope),
      nextCursor: events.at(-1)?.originSeq || normalizedCursor,
      hasMore: events.length === normalizedLimit && Boolean(
        listSyncChangesAfter(database, originDeviceId, events.at(-1)?.originSeq || normalizedCursor, 1).length,
      ),
    };
  }

  function markChangesSent({ localDeviceId = context().deviceId, remoteDeviceId, throughOriginSeq }) {
    assertPeer(localDeviceId, remoteDeviceId);
    const sequence = positiveCursor(throughOriginSeq);
    ensureSyncState(database, localDeviceId, remoteDeviceId);
    return updateSyncState(database, localDeviceId, remoteDeviceId, { lastSentLocalSeq: sequence });
  }

  function applyChanges({ localDeviceId = context().deviceId, remoteDeviceId, events } = {}) {
    const local = context();
    assertLocalDevice(localDeviceId, local.deviceId);
    assertPeer(localDeviceId, remoteDeviceId);
    if (!Array.isArray(events)) throw new SyncValidationError("Sync events must be an array.");

    ensureSyncState(database, localDeviceId, remoteDeviceId);
    updateSyncState(database, localDeviceId, remoteDeviceId, {
      status: "SYNCING",
      lastSyncStartedAt: nowUtc(),
      lastError: null,
    });

    const results = [];
    for (const event of events) {
      results.push(applyOne(event, { local, localDeviceId, remoteDeviceId, retryPending: false }));
    }
    results.push(...retryPendingChanges({ localDeviceId, remoteDeviceId, local }));

    const rejected = results.find((result) => result.status === "REJECTED");
    updateSyncState(database, localDeviceId, remoteDeviceId, {
      status: "IDLE",
      lastSyncCompletedAt: nowUtc(),
      lastError: rejected?.error || null,
    });
    return {
      results,
      cursor: getSyncState(localDeviceId, remoteDeviceId).lastReceivedRemoteSeq,
    };
  }

  function retryPendingChanges({ localDeviceId = context().deviceId, remoteDeviceId, local = context() } = {}) {
    assertLocalDevice(localDeviceId, local.deviceId);
    assertPeer(localDeviceId, remoteDeviceId);
    const pending = listPendingSyncChanges(database, localDeviceId, remoteDeviceId);
    const results = [];
    for (const item of pending) {
      const stored = findSyncChangeById(database, item.changeId);
      if (stored) results.push(applyOne(stored, { local, localDeviceId, remoteDeviceId, retryPending: true }));
    }
    return results;
  }

  function getSyncState(localDeviceId = context().deviceId, remoteDeviceId) {
    assertPeer(localDeviceId, remoteDeviceId);
    return ensureSyncState(database, localDeviceId, remoteDeviceId);
  }

  function applyOne(inputEvent, { local, localDeviceId, remoteDeviceId, retryPending }) {
    let event;
    try {
      event = toEventEnvelope(inputEvent);
      validateEvent(event, local.userId);
      validateRegisteredDevices(event, local.userId, remoteDeviceId);
    } catch (error) {
      const result = rejectedResult(inputEvent, error);
      log("event rejected", eventSummary(inputEvent, result.status));
      return result;
    }

    const existing = findSyncChangeById(database, event.changeId);
    const existingReceipt = existing ? findSyncReceipt(database, event.changeId, localDeviceId) : null;
    if (existing) {
      if (!sameStoredEvent(existing, event)) {
        const result = rejectedResult(event, new SyncValidationError("changeId already exists with different event data."));
        log("event rejected", eventSummary(event, result.status));
        return result;
      }
      if (!existingReceipt || (existingReceipt.status !== "PENDING" || !retryPending)) {
        const result = {
          status: existingReceipt && ["APPLIED", "CONFLICT"].includes(existingReceipt.status)
            ? "DUPLICATE"
            : existingReceipt?.status || "DUPLICATE",
          previousStatus: existingReceipt?.status || null,
          changeId: event.changeId,
          duplicate: true,
        };
        log("event replay detected", eventSummary(event, result.status));
        return result;
      }
    }

    const sequenceCollision = findSyncChangeByOriginSequence(database, event.originDeviceId, event.originSeq);
    if (sequenceCollision && sequenceCollision.changeId !== event.changeId) {
      const result = rejectedResult(event, new SyncValidationError("originSeq already belongs to another change."));
      log("event rejected", eventSummary(event, result.status));
      return result;
    }

    try {
      const result = database.transaction(() => {
        if (!existing) insertSyncChange(database, event, remoteDeviceId);
        const missingDependency = findMissingDependency(event, local.userId);
        if (missingDependency) {
          const attemptedAt = nowUtc();
          saveSyncReceipt(database, {
            changeId: event.changeId,
            localDeviceId,
            remoteDeviceId,
            status: "PENDING",
            receivedAt: existingReceipt?.receivedAt || attemptedAt,
            processedAt: null,
            errorMessage: `Waiting for ${missingDependency.entityType}:${missingDependency.entityId}`,
          });
          insertPendingSyncChange(database, {
            changeId: event.changeId,
            localDeviceId,
            remoteDeviceId,
            dependencyEntityType: missingDependency.entityType,
            dependencyEntityId: missingDependency.entityId,
            queuedAt: existingReceipt?.receivedAt || attemptedAt,
            lastAttemptedAt: attemptedAt,
          });
          advanceReceivedCursor(database, localDeviceId, remoteDeviceId);
          return {
            status: "PENDING",
            changeId: event.changeId,
            dependency: missingDependency,
          };
        }

        const application = applyEntityEvent(event, localDeviceId, remoteDeviceId);
        if (application.status === "PENDING") {
          const attemptedAt = nowUtc();
          const dependency = application.pendingEntity;
          saveSyncReceipt(database, {
            changeId: event.changeId,
            localDeviceId,
            remoteDeviceId,
            status: "PENDING",
            receivedAt: existingReceipt?.receivedAt || attemptedAt,
            processedAt: null,
            errorMessage: `Waiting for ${dependency.entityType}:${dependency.entityId}`,
          });
          insertPendingSyncChange(database, {
            changeId: event.changeId,
            localDeviceId,
            remoteDeviceId,
            dependencyEntityType: dependency.entityType,
            dependencyEntityId: dependency.entityId,
            queuedAt: existingReceipt?.receivedAt || attemptedAt,
            lastAttemptedAt: attemptedAt,
          });
          advanceReceivedCursor(database, localDeviceId, remoteDeviceId);
          return {
            status: "PENDING",
            changeId: event.changeId,
            dependency,
          };
        }
        if (application.status === "CONFLICT") {
          insertSyncConflict(database, application.conflict);
        } else if (application.status === "APPLIED" && application.mutated) {
          // The adapter has already applied the canonical snapshot. No local
          // origin event is emitted for this remote operation.
        }

        const completedAt = nowUtc();
        saveSyncReceipt(database, {
          changeId: event.changeId,
          localDeviceId,
          remoteDeviceId,
          status: application.status,
          receivedAt: existingReceipt?.receivedAt || completedAt,
          processedAt: completedAt,
          errorMessage: application.error || null,
        });
        removePendingSyncChange(database, event.changeId);
        advanceReceivedCursor(database, localDeviceId, remoteDeviceId);
        return {
          status: application.status,
          changeId: event.changeId,
          version: application.version,
          conflictId: application.conflict?.id,
        };
      })();
      log("event applied", eventSummary(event, result.status));
      return result;
    } catch (error) {
      log("event rejected", eventSummary(event, "REJECTED"));
      return rejectedResult(event, error);
    }
  }

  function applyEntityEvent(event, localDeviceId, remoteDeviceId) {
    const current = findEntity(database, event.entityType, event.entityId);
    const incoming = canonicalSnapshot(event.entityType, event.payload);

    if (event.operation === "CREATE") {
      if (!current) {
        if (event.entityType === "ACCOUNT") applyAccountCreate(database, incoming);
        else applyTradeCreate(database, incoming);
        return { status: "APPLIED", mutated: true, version: incoming.version };
      }
      if (sameSnapshot(event.entityType, current, incoming)) return { status: "APPLIED", mutated: false, version: current.version };
      return { status: "CONFLICT", conflict: buildConflict(event, current, localDeviceId, remoteDeviceId) };
    }

    if (!current) {
      return { status: "PENDING", pendingEntity: { entityType: event.entityType, entityId: event.entityId } };
    }
    if (sameSnapshot(event.entityType, current, incoming)) {
      return { status: "APPLIED", mutated: false, version: current.version };
    }
    if (current.version !== event.baseVersion) {
      return { status: "CONFLICT", conflict: buildConflict(event, current, localDeviceId, remoteDeviceId) };
    }

    const applied = event.entityType === "ACCOUNT"
      ? applyAccountSnapshotToDatabase(database, incoming)
      : applyTradeSnapshotToDatabase(database, incoming);
    if (!applied) throw new Error(`Unable to apply ${event.entityType}:${event.entityId}.`);
    return { status: "APPLIED", mutated: true, version: applied.version };
  }

  function findMissingDependency(event, userId) {
    for (const dependency of event.dependencies) {
      if (dependency.entityType === "USER") {
        if (dependency.entityId !== userId) throw new SyncValidationError("Sync event belongs to another workspace.");
        continue;
      }
      if (dependency.entityType === "ACCOUNT") {
        const account = findEntity(database, "ACCOUNT", dependency.entityId);
        if (!account || (account.deletedAt && event.operation !== "DELETE")) return dependency;
        continue;
      }
      throw new SyncValidationError(`Unsupported sync dependency: ${dependency.entityType}.`);
    }
    return null;
  }

  function buildConflict(event, current, localDeviceId, remoteDeviceId) {
    const localPayload = canonicalSnapshot(event.entityType, current);
    const localChange = findSyncChangesForEntityVersion(database, event.entityType, event.entityId, current.version);
    const baseChange = event.baseVersion
      ? findSyncChangesForEntityVersion(database, event.entityType, event.entityId, event.baseVersion)
      : null;
    const deleteConflict = event.operation === "DELETE" || Boolean(current.deletedAt);
    const localChangedFields = localChange?.changedFields || [];
    const sharedField = event.changedFields.find((field) => localChangedFields.includes(field)) || null;
    return {
      id: createId(),
      entityType: event.entityType,
      entityId: event.entityId,
      conflictType: deleteConflict ? "DELETE_EDIT_CONFLICT" : "FIELD_CONFLICT",
      fieldName: sharedField,
      localDeviceId,
      remoteDeviceId: event.originDeviceId || remoteDeviceId,
      baseVersion: event.baseVersion,
      localPayload,
      remotePayload: event.payload,
      detectedAt: nowUtc(),
      localChangeId: localChange?.changeId || null,
      remoteChangeId: event.changeId,
      basePayload: baseChange?.payload || null,
    };
  }

  function validateRegisteredDevices(event, userId, remoteDeviceId) {
    const remote = findDeviceById(database, remoteDeviceId);
    if (!remote || remote.userId !== userId) throw new SyncValidationError("Remote device is not registered in this workspace.");
    for (const deviceId of [event.originDeviceId, event.payload.originDeviceId, event.payload.lastModifiedByDeviceId]) {
      const device = findDeviceById(database, deviceId);
      if (!device || device.userId !== userId) throw new SyncValidationError("Event provenance device is not registered in this workspace.");
    }
  }

  function assertLocalDevice(localDeviceId, expectedDeviceId) {
    if (!localDeviceId || localDeviceId !== expectedDeviceId) {
      throw new SyncValidationError("Sync localDeviceId does not match the active installation.");
    }
    const localDevice = findDeviceById(database, localDeviceId);
    if (!localDevice || localDevice.userId !== context().userId) throw new SyncValidationError("Local device is not registered.");
  }

  function assertPeer(localDeviceId, remoteDeviceId) {
    if (!remoteDeviceId || remoteDeviceId === localDeviceId) throw new SyncValidationError("A distinct remote device is required.");
    const remote = findDeviceById(database, remoteDeviceId);
    if (!remote || remote.userId !== context().userId) throw new SyncValidationError("Remote device is not registered in this workspace.");
  }

  return {
    recordLocalMutation,
    getChangesAfter,
    markChangesSent,
    applyChanges,
    retryPendingChanges,
    getSyncState,
  };
}

export function validateEvent(event, userId = null) {
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new SyncValidationError("Sync event must be an object.");
  if (!isUuidLike(event.changeId) || !isUuidLike(event.originDeviceId) || !isUuidLike(event.entityId)) {
    throw new SyncValidationError("Sync event identifiers must be UUIDs.");
  }
  if (!SYNC_ENTITY_TYPES.has(event.entityType) || !SYNC_OPERATIONS.has(event.operation)) {
    throw new SyncValidationError("Sync event entity type or operation is unsupported.");
  }
  if (!Number.isSafeInteger(event.originSeq) || event.originSeq < 1) throw new SyncValidationError("originSeq must be a positive integer.");
  if (event.operation === "CREATE" && event.baseVersion !== null) throw new SyncValidationError("CREATE baseVersion must be null.");
  if (event.operation !== "CREATE" && (!Number.isSafeInteger(event.baseVersion) || event.baseVersion < 1)) {
    throw new SyncValidationError("UPDATE/DELETE baseVersion must be a positive integer.");
  }
  if (!Number.isSafeInteger(event.resultingVersion) || event.resultingVersion < 1) throw new SyncValidationError("resultingVersion is invalid.");
  if (event.operation === "CREATE" && event.resultingVersion !== 1) throw new SyncValidationError("CREATE resultingVersion must be 1.");
  if (event.operation !== "CREATE" && event.resultingVersion !== event.baseVersion + 1) {
    throw new SyncValidationError("resultingVersion must be baseVersion + 1.");
  }
  if (!Array.isArray(event.changedFields) || event.changedFields.some((field) => typeof field !== "string")) {
    throw new SyncValidationError("changedFields must be an array of strings.");
  }
  if (!Array.isArray(event.dependencies) || event.dependencies.some((dependency) => (
    !dependency || typeof dependency !== "object" || !isUuidLike(dependency.entityId) || typeof dependency.entityType !== "string"
  ))) {
    throw new SyncValidationError("dependencies are invalid.");
  }
  if (event.protocolVersion !== SYNC_PROTOCOL_VERSION || event.payloadSchemaVersion !== SYNC_PAYLOAD_SCHEMA_VERSION) {
    throw new SyncValidationError("Unsupported sync protocol or payload schema version.");
  }
  if (typeof event.createdAt !== "string" || Number.isNaN(Date.parse(event.createdAt))) throw new SyncValidationError("createdAt is invalid.");
  validateSnapshot(event.entityType, event.payload);
  if (event.payload.id !== event.entityId) throw new SyncValidationError("Event entityId does not match payload id.");
  if (userId && event.payload.userId !== userId) throw new SyncValidationError("Sync event belongs to another workspace.");
  const expectedDependencies = dependenciesFor(event.entityType, event.payload);
  if (canonicalJson(event.dependencies) !== canonicalJson(expectedDependencies)) throw new SyncValidationError("Sync dependencies do not match the payload.");
  if (event.payload.version !== event.resultingVersion) throw new SyncValidationError("Payload version does not match resultingVersion.");
  if (event.operation === "DELETE" && !event.payload.deletedAt) throw new SyncValidationError("DELETE payload must contain a tombstone.");
  if (event.operation !== "DELETE" && event.payload.deletedAt) throw new SyncValidationError("Only DELETE events may contain a tombstone.");
  if (event.payloadHash !== payloadHash(event.payload)) throw new SyncValidationError("Sync payload hash does not match payload.");
  return true;
}

function sameStoredEvent(stored, event) {
  return stored.originDeviceId === event.originDeviceId
    && stored.originSeq === event.originSeq
    && stored.entityType === event.entityType
    && stored.entityId === event.entityId
    && stored.operation === event.operation
    && stored.baseVersion === event.baseVersion
    && stored.resultingVersion === event.resultingVersion
    && stored.payloadHash === event.payloadHash
    && stored.protocolVersion === event.protocolVersion
    && stored.payloadSchemaVersion === event.payloadSchemaVersion;
}

function sameSnapshot(entityType, current, incoming) {
  return canonicalJson(canonicalSnapshot(entityType, current)) === canonicalJson(incoming);
}

function toEventEnvelope(event) {
  if (!event || typeof event !== "object") throw new SyncValidationError("Sync event must be an object.");
  return {
    changeId: event.changeId,
    originDeviceId: event.originDeviceId,
    originSeq: event.originSeq,
    entityType: event.entityType,
    entityId: event.entityId,
    operation: event.operation,
    baseVersion: event.baseVersion,
    resultingVersion: event.resultingVersion === undefined ? event.newVersion : event.resultingVersion,
    payload: event.payload,
    changedFields: event.changedFields,
    payloadHash: event.payloadHash,
    dependencies: event.dependencies,
    createdAt: event.createdAt,
    protocolVersion: event.protocolVersion,
    payloadSchemaVersion: event.payloadSchemaVersion,
  };
}

function rejectedResult(event, error) {
  return {
    status: "REJECTED",
    changeId: event?.changeId || null,
    error: error?.message || "Sync event was rejected.",
  };
}

function eventSummary(event, status) {
  return {
    changeId: event?.changeId || null,
    originDeviceId: event?.originDeviceId || null,
    originSeq: event?.originSeq || null,
    entityType: event?.entityType || null,
    entityId: event?.entityId || null,
    operation: event?.operation || null,
    status,
  };
}

function positiveCursor(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 0) throw new SyncValidationError("Sync cursor must be a non-negative integer.");
  return Number(value);
}

function positiveLimit(value) {
  if (!Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new SyncValidationError("Sync limit must be a positive integer.");
  return Number(value);
}

function isUuidLike(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
