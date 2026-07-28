import type { ErrorCategory } from "./types";

/**
 * Best-effort classification of a free-text error into a typed category for
 * run types that predate a dedicated `error_category` column (webhook and
 * mobile-push deliveries, TI feed/case-source poll status). Response action
 * and automation runs set `errorCategory` explicitly at write time instead of
 * relying on this guesswork; see `src/lib/response-actions/core.ts` and
 * `src/lib/automations/dispatch.ts`.
 */
export function classifyErrorMessage(message: string | null | undefined): ErrorCategory {
  if (!message) return "unknown";
  const value = message.toLowerCase();
  if (value.includes("kill switch")) return "kill_switch";
  if (value.includes("expired")) return "approval_expired";
  if (value.includes("no longer valid") || value.includes("no longer evidence")) {
    return "target_changed";
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
  if (value.includes("cancel")) return "cancelled";
  if (
    value.includes("config") ||
    value.includes("missing") && value.includes("token") ||
    value.includes("credential")
  ) {
    return "config";
  }
  if (/\bhttp\s?[45]\d\d\b/.test(value) || value.includes("rejected")) return "provider_error";
  if (value.includes("required") || value.includes("invalid")) return "validation";
  return "unknown";
}
