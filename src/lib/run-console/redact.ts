import { redactAuditSnapshot } from "@/lib/audit/redact";

/**
 * Every adapter builds its `inputSummary`/`outputSummary` through this
 * function before the run console persists or displays anything (issue #67:
 * "redaction happens before persistence and display"). It reuses the same
 * deny-listed key redaction and size/depth caps the audit log already relies
 * on, so credentials and raw sensitive payloads never reach a console record
 * regardless of what a handler or provider response happens to contain.
 */
export function buildRunSummary(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return redactAuditSnapshot(value);
}
