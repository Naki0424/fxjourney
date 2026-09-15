-- FXJourney Sync-0 / Sync-1 foundation.
-- This migration extends the reserved sync tables without changing Schema v1.

ALTER TABLE sync_changes ADD COLUMN payloadHash TEXT NOT NULL DEFAULT '';
ALTER TABLE sync_changes ADD COLUMN dependenciesJson TEXT NOT NULL DEFAULT '[]';
ALTER TABLE sync_changes ADD COLUMN protocolVersion TEXT NOT NULL DEFAULT '1';
ALTER TABLE sync_changes ADD COLUMN payloadSchemaVersion TEXT NOT NULL DEFAULT '1';

ALTER TABLE sync_conflicts ADD COLUMN localChangeId TEXT NULL;
ALTER TABLE sync_conflicts ADD COLUMN remoteChangeId TEXT NULL;
ALTER TABLE sync_conflicts ADD COLUMN basePayloadJson TEXT NULL;
ALTER TABLE sync_conflicts ADD COLUMN resolvedByDeviceId TEXT NULL;

CREATE TABLE IF NOT EXISTS sync_device_sequences (
  deviceId TEXT PRIMARY KEY,
  nextOriginSeq INTEGER NOT NULL DEFAULT 1 CHECK (nextOriginSeq >= 1),
  FOREIGN KEY (deviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_change_receipts (
  changeId TEXT PRIMARY KEY,
  localDeviceId TEXT NOT NULL,
  remoteDeviceId TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('APPLIED', 'PENDING', 'CONFLICT', 'REJECTED')),
  receivedAt TEXT NOT NULL,
  processedAt TEXT NULL,
  errorMessage TEXT NULL,
  FOREIGN KEY (changeId) REFERENCES sync_changes(changeId) ON DELETE RESTRICT,
  FOREIGN KEY (localDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (remoteDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_pending_changes (
  changeId TEXT PRIMARY KEY,
  localDeviceId TEXT NOT NULL,
  remoteDeviceId TEXT NOT NULL,
  dependencyEntityType TEXT NOT NULL,
  dependencyEntityId TEXT NOT NULL,
  queuedAt TEXT NOT NULL,
  lastAttemptedAt TEXT NOT NULL,
  FOREIGN KEY (changeId) REFERENCES sync_changes(changeId) ON DELETE RESTRICT,
  FOREIGN KEY (localDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (remoteDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sync_changes_origin_sequence
  ON sync_changes (originDeviceId, originSeq);
CREATE INDEX IF NOT EXISTS idx_sync_change_receipts_status
  ON sync_change_receipts (status);
CREATE INDEX IF NOT EXISTS idx_sync_pending_dependency
  ON sync_pending_changes (dependencyEntityType, dependencyEntityId);
CREATE INDEX IF NOT EXISTS idx_sync_conflicts_change_ids
  ON sync_conflicts (localChangeId, remoteChangeId);
