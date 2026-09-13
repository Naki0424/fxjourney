import { apiClient } from "./apiClient";

function queryString(filters) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.set(key, value);
    }
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const tradeService = {
  list(filters = {}) {
    return apiClient.get(`/api/trades${queryString(filters)}`);
  },
  get(id) {
    return apiClient.get(`/api/trades/${encodeURIComponent(id)}`);
  },
  create(fields) {
    return apiClient.post("/api/trades", fields);
  },
  update(id, fields, expectedVersion) {
    return apiClient.patch(`/api/trades/${encodeURIComponent(id)}`, {
      ...fields,
      expectedVersion,
    });
  },
  remove(id, expectedVersion) {
    return apiClient.delete(`/api/trades/${encodeURIComponent(id)}`, {
      body: { expectedVersion },
    });
  },
};
