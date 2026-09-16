-- FXJourney authenticated PC/device pairing and explicit peer endpoint state.
-- Pairing stores hashes and public metadata only; private keys remain local.

CREATE TABLE IF NOT EXISTS sync_pairing_invitations (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  ownerDeviceId TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  acceptedAt TEXT NULL,
  completedAt TEXT NULL,
  consumedAt TEXT NULL,
  joiningDeviceId TEXT NULL,
  joiningAuthAlgorithm TEXT NULL,
  joiningAuthPublicKey TEXT NULL,
  joiningAuthKeyFingerprint TEXT NULL,
  joiningEndpointUrl TEXT NULL,
  sessionNonceHash TEXT NULL,
  FOREIGN KEY (userId) REFERENCES user_profiles(id) ON DELETE RESTRICT,
  FOREIGN KEY (ownerDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (joiningDeviceId) REFERENCES devices(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS sync_peers (
  id TEXT PRIMARY KEY,
  localDeviceId TEXT NOT NULL,
  peerDeviceId TEXT NOT NULL,
  endpointUrl TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  lastSyncAt TEXT NULL,
  FOREIGN KEY (localDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  FOREIGN KEY (peerDeviceId) REFERENCES devices(id) ON DELETE RESTRICT,
  CHECK (localDeviceId <> peerDeviceId),
  UNIQUE (localDeviceId, peerDeviceId)
);

CREATE INDEX IF NOT EXISTS idx_sync_pairing_active
  ON sync_pairing_invitations (userId, ownerDeviceId, expiresAt, completedAt);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sync_pairing_pending_device
  ON sync_pairing_invitations (ownerDeviceId, joiningDeviceId)
  WHERE joiningDeviceId IS NOT NULL AND completedAt IS NULL;
CREATE INDEX IF NOT EXISTS idx_sync_peers_local
  ON sync_peers (localDeviceId, updatedAt);
