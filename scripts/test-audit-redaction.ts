/**
 * Unit coverage for the audit redaction/diff primitives (issue #45): key-name
 * based secret redaction, message/comment-body redaction, size/depth caps,
 * and minimal before/after diffing. No database or running server required —
 * this exercises `src/lib/audit/redact.ts` directly, in-process.
 */
import assert from "node:assert/strict";
import { buildAuditDiff, redactAuditSnapshot, redactAuditValue } from "../src/lib/audit/redact";

const REDACTED = "[redacted]";
const TRUNCATED = "[truncated]";
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_LENGTH = 50;

function main() {
  // ── 1. Sensitive key names are redacted anywhere in a nested object ──────
  for (const key of ["password", "secret", "apiKey", "token", "hmac"]) {
    const nested = redactAuditValue({
      outer: { inner: { [key]: "super-secret-value" } },
    }) as { outer: { inner: Record<string, unknown> } };
    assert.equal(
      nested.outer.inner[key],
      REDACTED,
      `key "${key}" nested inside an object must be redacted`,
    );
  }
  console.log("ok: password/secret/apiKey/token/hmac keys are redacted at any nesting depth");

  // ── 2. Message/comment-body content keys are redacted too ────────────────
  for (const key of ["preview", "body", "message"]) {
    const result = redactAuditValue({ [key]: "This is the actual comment text" }) as Record<
      string,
      unknown
    >;
    assert.equal(result[key], REDACTED, `key "${key}" (message/comment body) must be redacted`);
  }
  console.log("ok: preview/body/message keys (comment/message body content) are redacted");

  // ── 3. Normal, non-sensitive keys pass through unchanged ──────────────────
  const normal = redactAuditValue({
    status: "contained",
    email: "analyst@example.com",
    role: "admin",
  }) as Record<string, unknown>;
  assert.deepEqual(normal, {
    status: "contained",
    email: "analyst@example.com",
    role: "admin",
  });
  console.log("ok: non-sensitive keys (status/email/role) pass through unchanged");

  // ── 4. A very long string gets truncated ──────────────────────────────────
  const longString = "a".repeat(MAX_STRING_LENGTH + 500);
  const truncatedString = redactAuditValue(longString) as string;
  assert.ok(
    truncatedString.length < longString.length,
    "an oversized string must be shortened",
  );
  assert.ok(
    truncatedString.startsWith("a".repeat(MAX_STRING_LENGTH)),
    "the truncated string must keep its first MAX_STRING_LENGTH characters",
  );
  assert.ok(
    truncatedString.endsWith(TRUNCATED),
    `the truncated string must end with the "${TRUNCATED}" marker`,
  );
  const shortString = "short value";
  assert.equal(
    redactAuditValue(shortString),
    shortString,
    "a string under the cap must be returned unchanged",
  );
  console.log("ok: an over-cap string is truncated with a marker; a short string is untouched");

  // ── 5. An array longer than the cap gets truncated ────────────────────────
  const longArray = Array.from({ length: MAX_ARRAY_LENGTH + 10 }, (_, i) => i);
  const truncatedArray = redactAuditValue(longArray) as unknown[];
  assert.equal(
    truncatedArray.length,
    MAX_ARRAY_LENGTH + 1,
    "an over-cap array must be capped plus one truncation marker entry",
  );
  assert.deepEqual(
    truncatedArray.slice(0, MAX_ARRAY_LENGTH),
    longArray.slice(0, MAX_ARRAY_LENGTH),
    "the kept items must be exactly the first MAX_ARRAY_LENGTH entries, in order",
  );
  assert.equal(truncatedArray[truncatedArray.length - 1], TRUNCATED);

  const shortArray = [1, 2, 3];
  assert.deepEqual(
    redactAuditValue(shortArray),
    shortArray,
    "an array under the cap must be returned unchanged",
  );
  console.log("ok: an over-cap array is truncated with a trailing marker; a short array is untouched");

  // ── 6. buildAuditDiff returns only changed keys, and null when identical ──
  const diff = buildAuditDiff({ a: 1, b: 2 }, { a: 1, b: 3 });
  assert.deepEqual(diff, { before: { b: 2 }, after: { b: 3 } });

  const noDiff = buildAuditDiff({ a: 1, b: 2 }, { a: 1, b: 2 });
  assert.equal(noDiff, null, "an identical before/after must diff to null");

  const bothNull = buildAuditDiff(null, null);
  assert.equal(bothNull, null, "before=null, after=null must diff to null");

  const addedKey = buildAuditDiff({ a: 1 }, { a: 1, b: 2 });
  assert.ok(addedKey, "a key added only in `after` must still produce a diff");
  assert.equal(addedKey?.after.b, 2, "a key present only in `after` must appear on the after side");
  assert.ok(
    !("a" in addedKey!.before) && !("a" in addedKey!.after),
    "an unchanged key must not appear in the diff at all",
  );

  console.log("ok: buildAuditDiff isolates changed keys and returns null when unchanged/absent");

  // buildAuditDiff redacts by key name at every level, including its own
  // top-level keys — not just keys nested inside an object it recurses into.
  const diffWithTopLevelSecret = buildAuditDiff({ password: "old-pass" }, { password: "new-pass" });
  assert.deepEqual(
    diffWithTopLevelSecret,
    { before: { password: REDACTED }, after: { password: REDACTED } },
    "a top-level sensitive key name must be redacted by buildAuditDiff itself",
  );
  const diffWithNestedSecret = buildAuditDiff(
    { creds: { password: "old-pass" } },
    { creds: { password: "new-pass" } },
  );
  assert.deepEqual(
    diffWithNestedSecret,
    { before: { creds: { password: REDACTED } }, after: { creds: { password: REDACTED } } },
    "a sensitive key nested one level below the diff's top level is redacted",
  );
  console.log(
    "ok: buildAuditDiff redacts sensitive key names at both its own top level and nested levels",
  );

  // ── 7. Deeply nested objects past the depth cap collapse to a marker ─────
  const deeplyNested = { a: { b: { c: { d: { e: { f: { g: "deep leaf value" } } } } } } };
  const redactedDeep = redactAuditValue(deeplyNested) as {
    a: { b: { c: { d: { e: { f: unknown } } } } };
  };
  const atDepthCap = redactedDeep.a.b.c.d.e.f;
  assert.equal(
    atDepthCap,
    TRUNCATED,
    "an object past the max recursion depth must collapse to the truncation marker rather than recursing",
  );
  console.log("ok: recursion past the depth cap collapses to a truncation marker, never infinitely recurses");

  // ── 8. redactAuditSnapshot returns null for an empty/absent snapshot ──────
  assert.equal(redactAuditSnapshot(null), null);
  assert.equal(redactAuditSnapshot(undefined), null);
  assert.equal(redactAuditSnapshot({}), null);
  const snapshot = redactAuditSnapshot({ status: "open", token: "klp_should_be_hidden" });
  assert.deepEqual(snapshot, { status: "open", token: REDACTED });
  console.log("ok: redactAuditSnapshot returns null for empty snapshots and redacts sensitive fields otherwise");

  console.log("audit redaction tests passed");
}

try {
  main();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
