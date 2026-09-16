function mapPeer(row) {
  return row ? { ...row } : null;
}

export function findSyncPeer(database, localDeviceId, peerDeviceId) {
  return mapPeer(database.prepare(
    "SELECT * FROM sync_peers WHERE localDeviceId = ? AND peerDeviceId = ?",
  ).get(localDeviceId, peerDeviceId));
}

export function listSyncPeers(database, localDeviceId) {
  return database.prepare(
    "SELECT * FROM sync_peers WHERE localDeviceId = ? ORDER BY updatedAt DESC, id ASC",
  ).all(localDeviceId).map(mapPeer);
}

export function upsertSyncPeer(database, peer) {
  database.prepare(`
    INSERT INTO sync_peers (id, localDeviceId, peerDeviceId, endpointUrl, createdAt, updatedAt, lastSyncAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (localDeviceId, peerDeviceId) DO UPDATE SET
      endpointUrl = excluded.endpointUrl,
      updatedAt = excluded.updatedAt,
      lastSyncAt = COALESCE(excluded.lastSyncAt, sync_peers.lastSyncAt)
  `).run(
    peer.id,
    peer.localDeviceId,
    peer.peerDeviceId,
    peer.endpointUrl,
    peer.createdAt,
    peer.updatedAt,
    peer.lastSyncAt ?? null,
  );
  return findSyncPeer(database, peer.localDeviceId, peer.peerDeviceId);
}

export function markSyncPeerUsed(database, localDeviceId, peerDeviceId, timestamp) {
  database.prepare(
    "UPDATE sync_peers SET updatedAt = ?, lastSyncAt = ? WHERE localDeviceId = ? AND peerDeviceId = ?",
  ).run(timestamp, timestamp, localDeviceId, peerDeviceId);
  return findSyncPeer(database, localDeviceId, peerDeviceId);
}
