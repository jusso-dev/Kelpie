export type SourceCursor = {
  timestamp: string;
  id: string;
};

function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

/** Parses new composite cursors and pre-existing timestamp-only cursors. */
export function parseSourceCursor(value: string | null): SourceCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { timestamp?: unknown; id?: unknown };
    if (validTimestamp(parsed.timestamp) && typeof parsed.id === "string") {
      return { timestamp: parsed.timestamp, id: parsed.id };
    }
  } catch {
    // Timestamp-only cursors predate composite cursors.
  }
  return validTimestamp(value) ? { timestamp: value, id: "\uffff" } : null;
}

export function serialiseSourceCursor(cursor: SourceCursor | null): string | null {
  return cursor ? JSON.stringify(cursor) : null;
}

export function compareSourceCursor(a: SourceCursor, b: SourceCursor): number {
  const timestampComparison = Date.parse(a.timestamp) - Date.parse(b.timestamp);
  return timestampComparison || a.id.localeCompare(b.id);
}

export function isAfterSourceCursor(
  candidate: SourceCursor,
  cursor: SourceCursor | null,
): boolean {
  return !cursor || compareSourceCursor(candidate, cursor) > 0;
}
