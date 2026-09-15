import { findAccountById, hasAnyTrades, insertAccount, listActiveAccountsByUserId, softDeleteAccountByVersion, updateAccountByVersion } from "../repositories/accountRepository.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { assertRequestObject, booleanValue, createId, integerValue, nowUtc, optionalText, parsePositiveVersion, requiredText, withTransaction } from "../utils.js";
import { createSyncService } from "../syncService.js";

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

export function createAccountService({ database, getContext, syncService } = {}) {
  const synchronization = syncService || createSyncService({ database, getContext });

  function context() {
    return getContext();
  }

  function ownedAccount(id, { includeInactive = true } = {}) {
    const account = findAccountById(database, id);
    if (!account || account.userId !== context().userId || account.deletedAt || (!includeInactive && !account.active)) {
      throw notFound("Account not found.");
    }
    return account;
  }

  function normalizeCurrencyCode(value) {
    const code = requiredText(value, "currencyCode", { maxLength: 3 }).toUpperCase();
    if (!CURRENCY_CODE_PATTERN.test(code)) throw badRequest("currencyCode must be a three-letter ISO-style code.");
    return code;
  }

  function normalizeAccountFields(source, { create = false } = {}) {
    return {
      name: requiredText(source.name, "name"),
      brokerName: optionalText(source.brokerName, "brokerName"),
      accountType: optionalText(source.accountType, "accountType"),
      currencyCode: normalizeCurrencyCode(source.currencyCode),
      currencyMinorDigits: integerValue(source.currencyMinorDigits, "currencyMinorDigits", { nullable: false, min: 0, max: 9 }),
      initialBalanceMinor: integerValue(source.initialBalanceMinor, "initialBalanceMinor"),
      active: booleanValue(source.active, "active", { defaultValue: create ? true : undefined }),
    };
  }

  function create(body) {
    const source = assertRequestObject(body);
    const fields = normalizeAccountFields(source, { create: true });
    const localContext = context();
    const timestamp = nowUtc();
    const account = {
      id: createId(),
      userId: localContext.userId,
      ...fields,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      version: 1,
      originDeviceId: localContext.deviceId,
      lastModifiedByDeviceId: localContext.deviceId,
    };
    return withTransaction(database, () => {
      const created = insertAccount(database, account);
      synchronization.recordLocalMutation({ entityType: "ACCOUNT", operation: "CREATE", after: created });
      return created;
    });
  }

  function list() {
    return listActiveAccountsByUserId(database, context().userId);
  }

  function get(id) {
    return ownedAccount(id);
  }

  function update(id, body, expectedVersion) {
    const source = assertRequestObject(body);
    const current = ownedAccount(id, { includeInactive: false });
    const version = parsePositiveVersion(expectedVersion);
    const mutableFields = ["name", "brokerName", "accountType", "currencyCode", "currencyMinorDigits", "initialBalanceMinor", "active"];
    if (!mutableFields.some((field) => Object.prototype.hasOwnProperty.call(source, field))) {
      throw badRequest("At least one account field must be provided for update.");
    }

    const next = normalizeAccountFields({ ...current, ...source });
    const currencyChanged = next.currencyCode !== current.currencyCode || next.currencyMinorDigits !== current.currencyMinorDigits;
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      if (currencyChanged && hasAnyTrades(database, current.id)) {
        throw conflict("An account currency cannot be changed after trades exist.", "ACCOUNT_CURRENCY_LOCKED");
      }
      const updated = updateAccountByVersion(database, {
        ...current,
        ...next,
        updatedAt: timestamp,
        lastModifiedByDeviceId: context().deviceId,
      }, version);
      if (!updated) throw conflict("The account was changed by another operation.", "STALE_VERSION");
      synchronization.recordLocalMutation({ entityType: "ACCOUNT", operation: "UPDATE", before: current, after: updated });
      return updated;
    });
  }

  function remove(id, expectedVersion) {
    const current = ownedAccount(id, { includeInactive: false });
    const version = parsePositiveVersion(expectedVersion);
    const timestamp = nowUtc();
    return withTransaction(database, () => {
      const deleted = softDeleteAccountByVersion(database, {
        id: current.id,
        userId: current.userId,
        deletedAt: timestamp,
        updatedAt: timestamp,
        deviceId: context().deviceId,
      }, version);
      if (!deleted) throw conflict("The account was changed by another operation.", "STALE_VERSION");
      synchronization.recordLocalMutation({ entityType: "ACCOUNT", operation: "DELETE", before: current, after: deleted });
      return deleted;
    });
  }

  return { create, list, get, update, remove };
}
