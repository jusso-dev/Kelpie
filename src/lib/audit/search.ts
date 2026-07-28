import { and, desc, eq, gte, lte, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents } from "@/db/schema";

export interface AuditEventFilters {
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  /** Free-text match over action, target type/id/label, and actor label. */
  q?: string;
}

export type AuditEventRow = typeof auditEvents.$inferSelect;

export const DEFAULT_AUDIT_PAGE_SIZE = 50;
export const MAX_AUDIT_PAGE_SIZE = 200;

export function clampAuditLimit(requested: number | null | undefined): number {
  if (!requested || !Number.isFinite(requested) || requested <= 0) {
    return DEFAULT_AUDIT_PAGE_SIZE;
  }
  return Math.min(Math.floor(requested), MAX_AUDIT_PAGE_SIZE);
}

/**
 * Builds the shared, org-scoped WHERE clause for `audit_events`. Both the
 * admin search UI, the `audit:read` API route, and the export job call this
 * so an export can never see events the equivalent search wouldn't have
 * returned (issue #45: "Exports enforce identical filters and permissions").
 */
export function auditEventFilterClauses(
  organisationId: string,
  filters: AuditEventFilters,
): SQL[] {
  const clauses: SQL[] = [eq(auditEvents.organisationId, organisationId)];
  if (filters.action) clauses.push(eq(auditEvents.action, filters.action));
  if (filters.actorId) clauses.push(eq(auditEvents.actorId, filters.actorId));
  if (filters.targetType) clauses.push(eq(auditEvents.targetType, filters.targetType));
  if (filters.targetId) clauses.push(eq(auditEvents.targetId, filters.targetId));
  if (filters.from) clauses.push(gte(auditEvents.occurredAt, filters.from));
  if (filters.to) clauses.push(lte(auditEvents.occurredAt, filters.to));
  if (filters.q && filters.q.trim()) {
    const term = `%${filters.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const match = or(
      sql`${auditEvents.action} ILIKE ${term}`,
      sql`${auditEvents.targetType} ILIKE ${term}`,
      sql`${auditEvents.targetId} ILIKE ${term}`,
      sql`${auditEvents.targetLabel} ILIKE ${term}`,
      sql`${auditEvents.actorLabel} ILIKE ${term}`,
    );
    if (match) clauses.push(match);
  }
  return clauses;
}

export interface AuditCursor {
  occurredAt: Date;
  id: string;
}

/** Opaque keyset-pagination cursor: `(occurred_at, id)` sorted descending, so pages stay stable under concurrent inserts. */
export function encodeAuditCursor(row: AuditCursor): string {
  return Buffer.from(`${row.occurredAt.toISOString()}|${row.id}`, "utf8").toString(
    "base64url",
  );
}

export function decodeAuditCursor(cursor: string | null | undefined): AuditCursor | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const separator = raw.lastIndexOf("|");
    if (separator < 0) return null;
    const occurredAt = new Date(raw.slice(0, separator));
    const id = raw.slice(separator + 1);
    if (Number.isNaN(occurredAt.getTime()) || !id) return null;
    return { occurredAt, id };
  } catch {
    return null;
  }
}

export async function searchAuditEvents(
  organisationId: string,
  filters: AuditEventFilters,
  opts: { limit?: number | null; cursor?: string | null } = {},
): Promise<{ events: AuditEventRow[]; nextCursor: string | null }> {
  const limit = clampAuditLimit(opts.limit);
  const clauses = auditEventFilterClauses(organisationId, filters);
  const cursor = decodeAuditCursor(opts.cursor);
  if (cursor) {
    clauses.push(
      sql`(${auditEvents.occurredAt}, ${auditEvents.id}) < (${cursor.occurredAt.toISOString()}::timestamptz, ${cursor.id})`,
    );
  }
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(...clauses))
    .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  const last = events[events.length - 1];
  return {
    events,
    nextCursor: hasMore && last ? encodeAuditCursor(last) : null,
  };
}

export async function getAuditEventDetail(
  organisationId: string,
  id: string,
): Promise<AuditEventRow | null> {
  const [row] = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.organisationId, organisationId), eq(auditEvents.id, id)))
    .limit(1);
  return row ?? null;
}

const EXPORT_BATCH_SIZE = 500;

/** Streams every matching row in stable, indexed batches — used by the export job so large datasets don't load into memory at once. */
export async function* iterateAuditEvents(
  organisationId: string,
  filters: AuditEventFilters,
): AsyncGenerator<AuditEventRow> {
  let cursor: string | null = null;
  for (;;) {
    const { events, nextCursor } = await searchAuditEvents(organisationId, filters, {
      limit: EXPORT_BATCH_SIZE,
      cursor,
    });
    for (const event of events) yield event;
    if (!nextCursor) return;
    cursor = nextCursor;
  }
}
