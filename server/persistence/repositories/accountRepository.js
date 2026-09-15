function mapAccount(row) {
  if (!row) return null;
  return { ...row, active: Boolean(row.active) };
}

export function findAccountById(database, id) {
  return mapAccount(database.prepare("SELECT * FROM accounts WHERE id = ?").get(id));
}

export function listActiveAccountsByUserId(database, userId) {
  return database.prepare(`
    SELECT * FROM accounts
    WHERE userId = ? AND active = 1 AND deletedAt IS NULL
    ORDER BY createdAt ASC, id ASC
  `).all(userId).map(mapAccount);
}

export function hasAnyTrades(database, accountId) {
  return Boolean(database.prepare("SELECT 1 FROM trades WHERE accountId = ? LIMIT 1").get(accountId));
}

export function insertAccount(database, account) {
  database.prepare(`
    INSERT INTO accounts (
      id, userId, name, brokerName, accountType, currencyCode,
      currencyMinorDigits, initialBalanceMinor, active, createdAt, updatedAt,
      deletedAt, version, originDeviceId, lastModifiedByDeviceId
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    account.id,
    account.userId,
    account.name,
    account.brokerName,
    account.accountType,
    account.currencyCode,
    account.currencyMinorDigits,
    account.initialBalanceMinor,
    account.active ? 1 : 0,
    account.createdAt,
    account.updatedAt,
    account.deletedAt,
    account.version,
    account.originDeviceId,
    account.lastModifiedByDeviceId,
  );
  return findAccountById(database, account.id);
}

export function updateAccountByVersion(database, account, expectedVersion) {
  const result = database.prepare(`
    UPDATE accounts SET
      name = ?, brokerName = ?, accountType = ?, currencyCode = ?,
      currencyMinorDigits = ?, initialBalanceMinor = ?, active = ?,
      updatedAt = ?, version = version + 1, lastModifiedByDeviceId = ?
    WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL
  `).run(
    account.name,
    account.brokerName,
    account.accountType,
    account.currencyCode,
    account.currencyMinorDigits,
    account.initialBalanceMinor,
    account.active ? 1 : 0,
    account.updatedAt,
    account.lastModifiedByDeviceId,
    account.id,
    account.userId,
    expectedVersion,
  );
  return result.changes === 1 ? findAccountById(database, account.id) : null;
}

// Sync applies an already-versioned canonical snapshot. It must not increment
// the incoming version as though the receiver authored a new local mutation.
export function applyAccountSnapshot(database, account) {
  const result = database.prepare(`
    UPDATE accounts SET
      name = ?, brokerName = ?, accountType = ?, currencyCode = ?,
      currencyMinorDigits = ?, initialBalanceMinor = ?, active = ?,
      createdAt = ?, updatedAt = ?, deletedAt = ?, version = ?,
      originDeviceId = ?, lastModifiedByDeviceId = ?
    WHERE id = ? AND userId = ?
  `).run(
    account.name,
    account.brokerName,
    account.accountType,
    account.currencyCode,
    account.currencyMinorDigits,
    account.initialBalanceMinor,
    account.active ? 1 : 0,
    account.createdAt,
    account.updatedAt,
    account.deletedAt,
    account.version,
    account.originDeviceId,
    account.lastModifiedByDeviceId,
    account.id,
    account.userId,
  );
  return result.changes === 1 ? findAccountById(database, account.id) : null;
}

export function softDeleteAccountByVersion(database, { id, userId, deletedAt, updatedAt, deviceId }, expectedVersion) {
  const result = database.prepare(`
    UPDATE accounts SET
      active = 0, deletedAt = ?, updatedAt = ?, version = version + 1,
      lastModifiedByDeviceId = ?
    WHERE id = ? AND userId = ? AND version = ? AND deletedAt IS NULL
  `).run(deletedAt, updatedAt, deviceId, id, userId, expectedVersion);
  return result.changes === 1 ? findAccountById(database, id) : null;
}
