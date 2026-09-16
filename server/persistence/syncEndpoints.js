import net from "node:net";

export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
export const DEFAULT_SYNC_BIND_HOST = "127.0.0.1";

export class SyncEndpointError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SyncEndpointError";
    this.code = code;
  }
}

export function normalizeHost(value) {
  const host = String(value || "").trim().toLowerCase();
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export function parseAllowedSyncHosts(value = process.env.FXJOURNEY_SYNC_PEER_HOSTS) {
  return new Set(
    String(value || "")
      .split(",")
      .map(normalizeHost)
      .filter(Boolean),
  );
}

export function isTailscaleAddress(host) {
  const normalized = normalizeHost(host);
  if (net.isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
  }
  return net.isIP(normalized) === 6 && normalized.startsWith("fd7a:115c:a1e0:");
}

export function resolveServerBindHost(value = process.env.FXJOURNEY_HOST) {
  const host = normalizeHost(value) || DEFAULT_SYNC_BIND_HOST;
  if (["0.0.0.0", "::", "::0", "*"].includes(host)) {
    throw new SyncEndpointError("INVALID_BIND_HOST", "FXJOURNEY_HOST must not be a wildcard address.");
  }
  if (LOOPBACK_HOSTS.has(host) || isTailscaleAddress(host)) return host;
  throw new SyncEndpointError(
    "INVALID_BIND_HOST",
    "FXJOURNEY_HOST must be 127.0.0.1, ::1, or a specific Tailscale address.",
  );
}

export function assertAdvertisedPeerUrl(peerUrl) {
  const parsed = parsePeerUrl(peerUrl, { allowedHosts: null });
  const host = normalizeHost(parsed.hostname);
  if (!LOOPBACK_HOSTS.has(host) && !isTailscaleAddress(host)) {
    throw new SyncEndpointError(
      "INVALID_ADVERTISED_ENDPOINT",
      "An advertised peer endpoint must use loopback or a specific Tailscale address.",
    );
  }
  return parsed;
}

export function assertSyncPeerUrl(peerUrl, { allowedHosts = parseAllowedSyncHosts() } = {}) {
  const parsed = parsePeerUrl(peerUrl, { allowedHosts });
  const host = normalizeHost(parsed.hostname);
  if (LOOPBACK_HOSTS.has(host)) return parsed;
  if (!isTailscaleAddress(host) || !normalizeAllowedHosts(allowedHosts).has(host)) {
    throw new SyncEndpointError(
      "PEER_ENDPOINT_NOT_ALLOWED",
      "The sync peer must be loopback or an explicitly allowlisted Tailscale address.",
    );
  }
  return parsed;
}

function parsePeerUrl(peerUrl, { allowedHosts }) {
  let parsed;
  try {
    parsed = new URL(peerUrl);
  } catch {
    throw new SyncEndpointError("INVALID_PEER_URL", "The configured sync peer URL is invalid.");
  }
  const host = normalizeHost(parsed.hostname);
  if (
    parsed.protocol !== "http:"
    || !host
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || !parsed.port
  ) {
    throw new SyncEndpointError(
      "INVALID_PEER_URL",
      "Sync peer URLs must use HTTP, an explicit port, and contain no credentials or extra path.",
    );
  }
  if (allowedHosts !== null && !LOOPBACK_HOSTS.has(host) && !normalizeAllowedHosts(allowedHosts).has(host)) {
    throw new SyncEndpointError(
      "PEER_ENDPOINT_NOT_ALLOWED",
      "The sync peer address is not in the explicit peer allowlist.",
    );
  }
  return parsed;
}

function normalizeAllowedHosts(value) {
  return value instanceof Set
    ? new Set([...value].map(normalizeHost).filter(Boolean))
    : new Set((Array.isArray(value) ? value : String(value || "").split(",")).map(normalizeHost).filter(Boolean));
}
