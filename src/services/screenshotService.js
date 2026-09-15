import { apiClient } from "./apiClient";

function queryString(filters) {
  const params = new URLSearchParams();
  Object.entries(filters || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

export const screenshotService = {
  list(filters = {}) {
    return apiClient.get(`/api/screenshots${queryString(filters)}`);
  },
  get(id) {
    return apiClient.get(`/api/screenshots/${encodeURIComponent(id)}`);
  },
  upload(file, metadata = {}) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("metadata", JSON.stringify(metadata));
    return apiClient.post("/api/screenshots", formData);
  },
  update(id, fields, expectedVersion) {
    return apiClient.patch(`/api/screenshots/${encodeURIComponent(id)}`, {
      ...fields,
      expectedVersion,
    });
  },
  remove(id, expectedVersion) {
    return apiClient.delete(`/api/screenshots/${encodeURIComponent(id)}`, {
      body: { expectedVersion },
    });
  },
  contentUrl(id) {
    return `/api/screenshots/${encodeURIComponent(id)}/content`;
  },
  listFolders() {
    return apiClient.get("/api/folders");
  },
  createFolder(fields) {
    return apiClient.post("/api/folders", fields);
  },
  listTags() {
    return apiClient.get("/api/tags");
  },
  listCategories() {
    return apiClient.get("/api/categories");
  },
};
