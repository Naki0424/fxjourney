import { apiClient } from "./apiClient";

export const analysisPersistenceService = {
  listSessions() {
    return apiClient.get("/api/analyzer/sessions");
  },
  getState(sessionId) {
    return apiClient.get(`/api/analyzer/sessions/${encodeURIComponent(sessionId)}/state`);
  },
};
