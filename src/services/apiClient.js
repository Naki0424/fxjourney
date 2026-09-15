const configuredBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "")
  .trim()
  .replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message, { status = null, code = null, payload = null } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function request(path, { method = "GET", body, signal, headers = {} } = {}) {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const response = await fetch(`${configuredBaseUrl}${path}`, {
    method,
    signal,
    headers: {
      ...(body === undefined || isFormData ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
  });

  const responseText = await response.text();
  let payload = null;
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
  }

  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null
      ? payload.error || payload.message
      : null;
    throw new ApiError(message || `Request failed with status ${response.status}.`, {
      status: response.status,
      code: typeof payload === "object" && payload !== null ? payload.code : null,
      payload,
    });
  }

  return payload;
}

export const apiClient = {
  get(path, options) {
    return request(path, { ...options, method: "GET" });
  },
  post(path, body, options) {
    return request(path, { ...options, method: "POST", body });
  },
  patch(path, body, options) {
    return request(path, { ...options, method: "PATCH", body });
  },
  delete(path, options) {
    return request(path, { ...options, method: "DELETE" });
  },
};
