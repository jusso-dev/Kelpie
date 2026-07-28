/**
 * Shared keyset-pagination cursor for the investigation-model list endpoints
 * (alerts, entities, evidence items): opaque `(createdAt|lastSeenAt, id)`
 * cursor, same shape and stability guarantee as
 * `src/lib/audit/search.ts`'s cursor (stable ordering under concurrent
 * inserts, no offset drift).
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampLimit(requested: number | null | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_PAGE_SIZE);
}

export interface KeysetCursor {
  at: Date;
  id: string;
}

export function encodeCursor(row: KeysetCursor): string {
  return Buffer.from(`${row.at.toISOString()}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

export type ListPage<T> = { items: T[]; nextCursor: string | null };

export function decodeCursor(cursor: string | null | undefined): KeysetCursor | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    if (separator < 0) return null;
    const at = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (Number.isNaN(at.getTime()) || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}
