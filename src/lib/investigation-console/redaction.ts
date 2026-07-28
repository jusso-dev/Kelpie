import { redactAuditSnapshot, redactAuditValue } from "@/lib/audit/redact";
import { buildRunErrorSummary } from "@/lib/run-console/redact";

const REDACTED = "[redacted]";

/**
 * Redact command parameters before persistence. Keys listed on the handler
 * (or matching the audit deny-list) become `[redacted]`. Nested objects are
 * size/depth capped via the same audit redactor.
 */
export function redactParams(
  params: Record<string, unknown>,
  extraKeys: string[] = [],
): Record<string, unknown> {
  const force = new Set(extraKeys.map((k) => k.toLowerCase()));
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (force.has(key.toLowerCase())) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactAuditValue(value);
  }
  return (redactAuditSnapshot(out) as Record<string, unknown>) ?? {};
}

/** Redact a result payload for storage and display (untrusted). */
export function redactResult(value: unknown): unknown {
  return redactAuditValue(value);
}

/** Free-text error scrubbing shared with the run console. */
export function redactError(message: string | null | undefined): string | null {
  return buildRunErrorSummary(message);
}
