/**
 * Integration diagnostics redaction. Stricter than general audit redaction:
 * diagnostics are support-exportable and must never include secrets, tokens,
 * client secrets, webhook signing keys, or raw provider payloads.
 */

const SENSITIVE_KEY =
  /password|secret|token|apikey|api[_-]?key|authorization|cookie|credential|private[_-]?key|hmac|signature|passphrase|client[_-]?secret|encryption[_-]?key|refresh[_-]?token|access[_-]?token|bearer|webhook[_-]?secret/i;

const SENSITIVE_VALUE =
  /\bklp_[A-Za-z0-9_-]+\b|bearer\s+\S+|(?:client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[=:]\s*\S+/gi;

const MAX_DEPTH = 5;
const MAX_STRING = 500;
const MAX_ARRAY = 30;
const REDACTED = "[redacted]";
const TRUNCATED = "[truncated]";

export function redactDiagnosticMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  const cleaned = message
    .replace(SENSITIVE_VALUE, REDACTED)
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_STRING
    ? `${cleaned.slice(0, MAX_STRING)}…${TRUNCATED}`
    : cleaned;
}

export function redactDiagnosticValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth >= MAX_DEPTH) return TRUNCATED;
  if (typeof value === "string") {
    const cleaned = value.replace(SENSITIVE_VALUE, REDACTED);
    return cleaned.length > MAX_STRING
      ? `${cleaned.slice(0, MAX_STRING)}…${TRUNCATED}`
      : cleaned;
  }
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY)
      .map((item) => redactDiagnosticValue(item, depth + 1));
    return value.length > MAX_ARRAY ? [...items, TRUNCATED] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key)
      ? REDACTED
      : redactDiagnosticValue(v, depth + 1);
  }
  return out;
}

/** Returns a shallow object free of secret-shaped keys for export. */
export function redactDiagnosticObject(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!value) return {};
  return redactDiagnosticValue(value) as Record<string, unknown>;
}

/**
 * Short non-reversible fingerprint for a secret (last-4 of a stable hash).
 * Used only for rotation detection in UI — never reconstructs the secret.
 */
export function credentialFingerprint(secret: string): string {
  // Lightweight FNV-1a 32-bit so we do not pull crypto into every path; only
  // the last four hex digits are shown, so collisions are acceptable.
  let hash = 0x811c9dc5;
  for (let i = 0; i < secret.length; i++) {
    hash ^= secret.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0").slice(-4);
}
