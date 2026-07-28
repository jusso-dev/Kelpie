import type { HealthErrorCategory } from "./types";

/**
 * Map free-text provider/config errors into the typed health categories used
 * by the shared integration contract. Prefer explicit categories at write
 * sites; this is a safety net for connectors that still store free-text
 * `lastError` columns.
 */
export function classifyHealthError(
  message: string | null | undefined,
  opts: {
    httpStatus?: number | null;
    rateLimited?: boolean;
    paused?: boolean;
    credentialExpired?: boolean;
    subscriptionExpired?: boolean;
  } = {},
): HealthErrorCategory | null {
  if (opts.paused) return "paused";
  if (opts.credentialExpired) return "credential_expired";
  if (opts.subscriptionExpired) return "subscription_expired";
  if (opts.rateLimited || opts.httpStatus === 429) return "rate_limit";

  if (!message) {
    if (opts.httpStatus === 401 || opts.httpStatus === 403) return "auth";
    if (opts.httpStatus && opts.httpStatus >= 500) return "provider_error";
    return null;
  }

  const value = message.toLowerCase();
  if (value.includes("paused")) return "paused";
  if (
    value.includes("expired") &&
    (value.includes("credential") || value.includes("token") || value.includes("secret"))
  ) {
    return "credential_expired";
  }
  if (value.includes("expir") && value.includes("credential")) {
    return "credential_expiring";
  }
  if (
    value.includes("subscription") &&
    (value.includes("expir") || value.includes("renew"))
  ) {
    return "subscription_expired";
  }
  if (
    value.includes("rate limit") ||
    value.includes("retry-after") ||
    value.includes("throttl") ||
    value.includes("429")
  ) {
    return "rate_limit";
  }
  if (
    value.includes("stale cursor") ||
    value.includes("cursor") && value.includes("invalid")
  ) {
    return "stale_cursor";
  }
  if (
    value.includes("unauthorized") ||
    value.includes("unauthorised") ||
    value.includes("401") ||
    value.includes("invalid_client") ||
    value.includes("aadsts") ||
    value.includes("authentication")
  ) {
    return "auth";
  }
  if (
    value.includes("forbidden") ||
    value.includes("403") ||
    value.includes("permission") ||
    value.includes("scope")
  ) {
    return "permission";
  }
  if (value.includes("timeout") || value.includes("timed out")) return "timeout";
  if (
    value.includes("econnrefused") ||
    value.includes("enotfound") ||
    value.includes("network") ||
    value.includes("fetch failed") ||
    value.includes("dns")
  ) {
    return "network";
  }
  if (
    value.includes("config") ||
    value.includes("required") ||
    value.includes("missing")
  ) {
    return "config";
  }
  if (value.includes("conflict")) return "conflict";
  if (opts.httpStatus === 401 || opts.httpStatus === 403) return "auth";
  if (opts.httpStatus && opts.httpStatus >= 400) return "provider_error";
  return "provider_error";
}
