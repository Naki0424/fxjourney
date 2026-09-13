import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiClient } from "../services/apiClient";

const ApplicationContext = createContext(null);

const initialBootstrap = {
  status: "loading",
  userProfile: null,
  device: null,
  accounts: [],
  error: null,
};

function normalizeBootstrap(payload) {
  return {
    userProfile: payload?.userProfile || null,
    device: payload?.device || null,
    accounts: Array.isArray(payload?.accounts) ? payload.accounts : [],
  };
}

function selectAccountId(accounts, currentId) {
  if (currentId && accounts.some((account) => account.id === currentId)) {
    return currentId;
  }
  return accounts[0]?.id || null;
}

export function ApplicationProvider({ children }) {
  const [bootstrap, setBootstrap] = useState(initialBootstrap);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [accountError, setAccountError] = useState(null);

  const applyBootstrap = useCallback((payload) => {
    const next = normalizeBootstrap(payload);
    setBootstrap({ ...next, status: "ready", error: null });
    setSelectedAccountId((currentId) => selectAccountId(next.accounts, currentId));
    return next;
  }, []);

  const loadBootstrap = useCallback(async () => {
    setBootstrap((current) => ({ ...current, status: "loading", error: null }));
    try {
      const payload = await apiClient.get("/api/bootstrap");
      return applyBootstrap(payload);
    } catch (error) {
      setBootstrap((current) => ({ ...current, status: "error", error }));
      return null;
    }
  }, [applyBootstrap]);

  useEffect(() => {
    loadBootstrap();
  }, [loadBootstrap]);

  const refreshAccounts = useCallback(async () => {
    try {
      const payload = await apiClient.get("/api/bootstrap");
      const next = normalizeBootstrap(payload);
      setBootstrap((current) => ({
        ...current,
        ...next,
        status: "ready",
        error: null,
      }));
      setSelectedAccountId((currentId) => selectAccountId(next.accounts, currentId));
      setAccountError(null);
      return next.accounts;
    } catch (error) {
      setAccountError(error);
      throw error;
    }
  }, []);

  const createAccount = useCallback(async (fields) => {
    setAccountError(null);
    try {
      const { account } = await apiClient.post("/api/accounts", fields);
      await refreshAccounts();
      setSelectedAccountId(account.id);
      return account;
    } catch (error) {
      setAccountError(error);
      throw error;
    }
  }, [refreshAccounts]);

  const updateAccount = useCallback(async (id, fields) => {
    setAccountError(null);
    try {
      const current = bootstrap.accounts.find((account) => account.id === id);
      const expectedVersion = fields.expectedVersion ?? current?.version;
      const { account } = await apiClient.patch(`/api/accounts/${id}`, {
        ...fields,
        expectedVersion,
      });
      await refreshAccounts();
      return account;
    } catch (error) {
      setAccountError(error);
      throw error;
    }
  }, [bootstrap.accounts, refreshAccounts]);

  const removeAccount = useCallback(async (id) => {
    setAccountError(null);
    try {
      const current = bootstrap.accounts.find((account) => account.id === id);
      await apiClient.delete(`/api/accounts/${id}`, {
        body: { expectedVersion: current?.version },
      });
      await refreshAccounts();
      return true;
    } catch (error) {
      setAccountError(error);
      throw error;
    }
  }, [bootstrap.accounts, refreshAccounts]);

  const selectedAccount = useMemo(
    () => bootstrap.accounts.find((account) => account.id === selectedAccountId) || null,
    [bootstrap.accounts, selectedAccountId],
  );

  const value = useMemo(() => ({
    status: bootstrap.status,
    userProfile: bootstrap.userProfile,
    device: bootstrap.device,
    accounts: bootstrap.accounts,
    selectedAccount,
    selectedAccountId,
    setSelectedAccountId,
    error: bootstrap.error,
    accountError,
    refresh: loadBootstrap,
    refreshAccounts,
    createAccount,
    updateAccount,
    removeAccount,
  }), [
    bootstrap,
    selectedAccount,
    selectedAccountId,
    accountError,
    loadBootstrap,
    refreshAccounts,
    createAccount,
    updateAccount,
    removeAccount,
  ]);

  return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>;
}

export function useApplication() {
  const context = useContext(ApplicationContext);
  if (!context) throw new Error("useApplication must be used inside ApplicationProvider.");
  return context;
}
