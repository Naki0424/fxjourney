-- FXJourney authenticated loopback sync transport.
-- Private keys remain in the local identity file; only public metadata is stored here.

ALTER TABLE devices ADD COLUMN authAlgorithm TEXT NULL;
ALTER TABLE devices ADD COLUMN authPublicKey TEXT NULL;
ALTER TABLE devices ADD COLUMN authKeyFingerprint TEXT NULL;
ALTER TABLE devices ADD COLUMN trustedAt TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_auth_key_fingerprint
  ON devices (authKeyFingerprint)
  WHERE authKeyFingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_devices_sync_trust
  ON devices (userId, retiredAt, trustedAt);
