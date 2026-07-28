const POSTGRES_UNIQUE_VIOLATION = "23505";

function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  // drizzle-orm's postgres-js driver wraps the real `postgres` error as
  // `DrizzleQueryError`, preserving the original on `.cause`.
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === "object" && cause !== null) {
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") return causeCode;
  }
  return undefined;
}

/**
 * True when an insert/update failed a unique constraint, whether raised
 * directly by the `postgres` driver or wrapped by drizzle-orm's
 * `DrizzleQueryError`. Used by run lineage inserts (`response_action_runs`,
 * `automation_runs`) to turn a concurrent double-retry into a clear "already
 * requested" error instead of an opaque database exception.
 */
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === POSTGRES_UNIQUE_VIOLATION;
}
