import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { auditExportJobs } from "@/db/schema";
import { newId } from "@/lib/utils";
import { deleteFile, putFile } from "@/lib/storage";
import { type AuditEventFilters, type AuditEventRow, iterateAuditEvents } from "./search";

export type AuditExportFormat = "csv" | "ndjson";

/** JSON-safe wire form of `AuditEventFilters` (Date -> ISO string) for storage in `audit_export_jobs.filters`. */
export interface StorableAuditFilters {
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  q?: string;
}

export function toStorableAuditFilters(filters: AuditEventFilters): StorableAuditFilters {
  return {
    action: filters.action || undefined,
    actorId: filters.actorId || undefined,
    targetType: filters.targetType || undefined,
    targetId: filters.targetId || undefined,
    from: filters.from ? filters.from.toISOString() : undefined,
    to: filters.to ? filters.to.toISOString() : undefined,
    q: filters.q || undefined,
  };
}

export function fromStorableAuditFilters(raw: unknown): AuditEventFilters {
  const value = (raw ?? {}) as StorableAuditFilters;
  return {
    action: value.action || undefined,
    actorId: value.actorId || undefined,
    targetType: value.targetType || undefined,
    targetId: value.targetId || undefined,
    from: value.from ? new Date(value.from) : undefined,
    to: value.to ? new Date(value.to) : undefined,
    q: value.q || undefined,
  };
}

export async function createAuditExportJob(opts: {
  organisationId: string;
  requestedBy: string | null;
  format: AuditExportFormat;
  filters: AuditEventFilters;
}): Promise<{ id: string }> {
  const id = newId("auditexp");
  await db.insert(auditExportJobs).values({
    id,
    organisationId: opts.organisationId,
    requestedBy: opts.requestedBy,
    format: opts.format,
    filters: toStorableAuditFilters(opts.filters),
    status: "pending",
  });
  return { id };
}

const CSV_COLUMNS: Array<{ key: string; get: (row: AuditEventRow) => string }> = [
  { key: "id", get: (r) => r.id },
  { key: "occurred_at", get: (r) => r.occurredAt.toISOString() },
  { key: "actor_type", get: (r) => r.actorType },
  { key: "actor_id", get: (r) => r.actorId ?? "" },
  { key: "actor_label", get: (r) => r.actorLabel ?? "" },
  { key: "action", get: (r) => r.action },
  { key: "target_type", get: (r) => r.targetType },
  { key: "target_id", get: (r) => r.targetId ?? "" },
  { key: "target_label", get: (r) => r.targetLabel ?? "" },
  { key: "request_id", get: (r) => r.requestId ?? "" },
  { key: "source_ip", get: (r) => r.sourceIp ?? "" },
  { key: "user_agent", get: (r) => r.userAgent ?? "" },
  { key: "before", get: (r) => (r.before ? JSON.stringify(r.before) : "") },
  { key: "after", get: (r) => (r.after ? JSON.stringify(r.after) : "") },
  { key: "metadata", get: (r) => JSON.stringify(r.metadata ?? {}) },
];

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function csvHeaderRow(): string {
  return CSV_COLUMNS.map((c) => csvCell(c.key)).join(",");
}

function csvDataRow(row: AuditEventRow): string {
  return CSV_COLUMNS.map((c) => csvCell(c.get(row))).join(",");
}

function ndjsonRow(row: AuditEventRow): string {
  return JSON.stringify({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorType: row.actorType,
    actorId: row.actorId,
    actorLabel: row.actorLabel,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    targetLabel: row.targetLabel,
    requestId: row.requestId,
    sourceIp: row.sourceIp,
    userAgent: row.userAgent,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: row.metadata ?? {},
  });
}

const EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Runs one queued export: streams every matching row through the same
 * `iterateAuditEvents` filter path the search UI/API uses, writes the result
 * to blob storage, and marks the job completed/failed. Invoked by the
 * `export-audit-events` BullMQ job (src/jobs-worker.ts).
 */
export async function processAuditExportJob(jobId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(auditExportJobs)
    .where(eq(auditExportJobs.id, jobId))
    .limit(1);
  if (!job) return;
  await db
    .update(auditExportJobs)
    .set({ status: "processing" })
    .where(eq(auditExportJobs.id, jobId));
  try {
    const filters = fromStorableAuditFilters(job.filters);
    const lines: string[] = [];
    let rowCount = 0;
    if (job.format === "csv") lines.push(csvHeaderRow());
    for await (const event of iterateAuditEvents(job.organisationId, filters)) {
      lines.push(job.format === "csv" ? csvDataRow(event) : ndjsonRow(event));
      rowCount += 1;
    }
    const body = job.format === "csv" ? lines.join("\r\n") + "\r\n" : lines.map((l) => `${l}\n`).join("");
    const filename = `audit-events-${job.id}.${job.format === "csv" ? "csv" : "ndjson"}`;
    const stored = await putFile(Buffer.from(body, "utf8"), job.organisationId, filename);
    await db
      .update(auditExportJobs)
      .set({
        status: "completed",
        storageKey: stored.key,
        rowCount,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      })
      .where(eq(auditExportJobs.id, jobId));
  } catch (error) {
    await db
      .update(auditExportJobs)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : "Export failed",
      })
      .where(eq(auditExportJobs.id, jobId));
  }
}

/** Deletes completed export files past their TTL, and their job rows, so exports don't accumulate on disk forever. */
export async function purgeExpiredAuditExports(): Promise<{ purged: number }> {
  const expired = await db
    .select({ id: auditExportJobs.id, storageKey: auditExportJobs.storageKey })
    .from(auditExportJobs)
    .where(and(eq(auditExportJobs.status, "completed"), lt(auditExportJobs.expiresAt, new Date())));
  for (const job of expired) {
    if (job.storageKey) await deleteFile(job.storageKey).catch(() => {});
    await db.delete(auditExportJobs).where(eq(auditExportJobs.id, job.id));
  }
  return { purged: expired.length };
}
