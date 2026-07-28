/**
 * Deny-list of key-name fragments that must never reach `audit_events.before`,
 * `.after`, or `.metadata`, even if a caller passes them in by mistake. This is
 * defence in depth: call sites are expected to only pass small, curated field
 * diffs (never whole request/response bodies), but a secret-shaped key is
 * redacted regardless of who called this. Also covers message/comment body
 * content (issue #45: "Redact ... message bodies ... at write time"), e.g.
 * the `preview` field timeline comment events carry.
 */
const SENSITIVE_KEY_PATTERN =
  /password|secret|token|apikey|api_key|authorization|cookie|credential|privatekey|private_key|hmac|signature|otp|mfa|recoverycode|recovery_code|bearer|clientsecret|client_secret|encryptionkey|encryption_key|passphrase|^body$|_body$|^preview$|^message$|^content$/i;

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_LENGTH = 50;
const REDACTED = "[redacted]";
const TRUNCATED = "[truncated]";

/** Deep-redacts sensitive keys and caps size/depth so audit payloads stay small and safe. */
export function redactAuditValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}…${TRUNCATED}`
      : value;
  }
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const truncated = value.length > MAX_ARRAY_LENGTH;
    const items = value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => redactAuditValue(item, depth + 1));
    return truncated ? [...items, TRUNCATED] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = redactKeyedValue(key, v, depth + 1);
  }
  return out;
}

/** Redacts by key name first, then recurses — the check `redactAuditValue` applies to nested object keys, also applied here to a caller-supplied top-level key. */
function redactKeyedValue(key: string, value: unknown, depth: number): unknown {
  return SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactAuditValue(value, depth);
}

/** Redacts a full before/after/metadata snapshot object, or returns null for an empty one. */
export function redactAuditSnapshot(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value || Object.keys(value).length === 0) return null;
  return redactAuditValue(value) as Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (v instanceof Date ? v.toISOString() : v));
}

/**
 * Normalizes a mutation into a minimal, redacted before/after diff: only keys
 * that actually changed are kept, on both sides. This is what keeps audit
 * events small and free of whole-object/whole-body dumps (see issue #45's
 * "whole request or response bodies" out-of-scope note) while still giving
 * admins a structured change record.
 */
export function buildAuditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  if (!before && !after) return null;
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};
  let changed = false;
  for (const key of keys) {
    const b = before?.[key];
    const a = after?.[key];
    if (stableStringify(b) === stableStringify(a)) continue;
    changed = true;
    beforeOut[key] = redactKeyedValue(key, b, 0);
    afterOut[key] = redactKeyedValue(key, a, 0);
  }
  if (!changed) return null;
  return { before: beforeOut, after: afterOut };
}
