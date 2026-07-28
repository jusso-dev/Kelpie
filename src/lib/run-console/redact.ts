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

const REDACTED = "[redacted]";
const MAX_ERROR_LENGTH = 2_000;
const TRUNCATED = "[truncated]";

/**
 * Key-name fragments that mark the value following them as a secret. Kept
 * separate from the audit deny-list because that one matches object *keys*,
 * while this one has to find the same names embedded in free text.
 */
const SENSITIVE_KEY_FRAGMENT =
  "password|secret|token|api[_-]?key|apikey|authorization|cookie|credential|private[_-]?key|hmac|signature|passphrase|client[_-]?secret|encryption[_-]?key|refresh[_-]?token|access[_-]?token|id[_-]?token";

/** `token=abc`, `"client_secret": "abc"`, `Authorization: abc` — value redacted, key kept. */
const KEYED_SECRET = new RegExp(
  `(["']?(?:${SENSITIVE_KEY_FRAGMENT})["']?\\s*[:=]\\s*)(["']?)[^\\s,;&"'}\\]]+\\2`,
  "gi",
);

/** `Bearer eyJ...` / `Basic dXNlcjpwYXNz` in an echoed request header. */
const AUTH_SCHEME = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;

/** A JWT anywhere in the text, even with no preceding key name. */
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g;

/**
 * Long unbroken opaque runs. Deliberately set above the 36 characters of a
 * hyphenated GUID, so resource and correlation ids — genuinely useful in a
 * support-safe error — survive, while raw keys and session blobs do not.
 */
const LONG_OPAQUE_BLOB = /\b[A-Za-z0-9_-]{40,}\b/g;

/**
 * Redacts a free-text provider or handler error before it reaches a run
 * record. `inputSummary`/`outputSummary` are structured, so `buildRunSummary`
 * redacts them by key name; `errorSummary` is a bare string containing
 * whatever the upstream provider returned, so it needs pattern scrubbing.
 *
 * This matters because the run console grants observation separately from
 * control (issue #67), so a `read_only` analyst sees this field. Handlers
 * such as `entra-disable-user` and `cloudflare-block-ip` put raw provider
 * error strings on the run row, and those bodies can carry tenant detail or
 * echoed credentials.
 */
export function buildRunErrorSummary(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const scrubbed = value
    .replace(KEYED_SECRET, `$1${REDACTED}`)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(LONG_OPAQUE_BLOB, REDACTED);
  if (!scrubbed.trim()) return null;
  return scrubbed.length > MAX_ERROR_LENGTH
    ? `${scrubbed.slice(0, MAX_ERROR_LENGTH)}…${TRUNCATED}`
    : scrubbed;
}
