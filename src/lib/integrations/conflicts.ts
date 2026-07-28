import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cases,
  integrationSyncConflicts,
  type IntegrationSyncConflict,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { setOpenConflictCount } from "./state";
import type { ConnectionKind, ConflictStatus, SyncField } from "./types";
import { redactDiagnosticValue } from "./redact";

export async function openSyncConflict(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  caseId?: string | null;
  fieldName: SyncField | string;
  kelpieValue: unknown;
  sourceValue: unknown;
  kelpieUpdatedAt?: Date | null;
  sourceUpdatedAt?: Date | null;
  kelpieProvenance?: string | null;
  sourceProvenance?: string | null;
}): Promise<IntegrationSyncConflict> {
  // De-dupe open conflicts for the same case+field so the queue stays clean.
  if (opts.caseId) {
    const [existing] = await db
      .select()
      .from(integrationSyncConflicts)
      .where(
        and(
          eq(integrationSyncConflicts.organisationId, opts.organisationId),
          eq(integrationSyncConflicts.caseId, opts.caseId),
          eq(integrationSyncConflicts.fieldName, opts.fieldName),
          eq(integrationSyncConflicts.status, "open"),
        ),
      )
      .limit(1);
    if (existing) {
      const [updated] = await db
        .update(integrationSyncConflicts)
        .set({
          kelpieValue: redactDiagnosticValue(opts.kelpieValue) as object,
          sourceValue: redactDiagnosticValue(opts.sourceValue) as object,
          kelpieUpdatedAt: opts.kelpieUpdatedAt ?? existing.kelpieUpdatedAt,
          sourceUpdatedAt: opts.sourceUpdatedAt ?? existing.sourceUpdatedAt,
          kelpieProvenance: opts.kelpieProvenance ?? existing.kelpieProvenance,
          sourceProvenance: opts.sourceProvenance ?? existing.sourceProvenance,
        })
        .where(eq(integrationSyncConflicts.id, existing.id))
        .returning();
      return updated ?? existing;
    }
  }

  const [inserted] = await db
    .insert(integrationSyncConflicts)
    .values({
      id: newId("intconf"),
      organisationId: opts.organisationId,
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
      caseId: opts.caseId ?? null,
      fieldName: opts.fieldName,
      kelpieValue: redactDiagnosticValue(opts.kelpieValue) as object,
      sourceValue: redactDiagnosticValue(opts.sourceValue) as object,
      kelpieUpdatedAt: opts.kelpieUpdatedAt ?? null,
      sourceUpdatedAt: opts.sourceUpdatedAt ?? null,
      kelpieProvenance: opts.kelpieProvenance ?? "kelpie",
      sourceProvenance: opts.sourceProvenance ?? "source",
      status: "open",
    })
    .returning();

  await refreshOpenConflictCount(
    opts.organisationId,
    opts.connectionKind,
    opts.connectionId,
  );
  return inserted!;
}

export async function listOpenConflicts(
  organisationId: string,
  opts: { limit?: number; caseId?: string } = {},
): Promise<IntegrationSyncConflict[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const clauses = [
    eq(integrationSyncConflicts.organisationId, organisationId),
    eq(integrationSyncConflicts.status, "open"),
  ];
  if (opts.caseId) {
    clauses.push(eq(integrationSyncConflicts.caseId, opts.caseId));
  }
  return db
    .select()
    .from(integrationSyncConflicts)
    .where(and(...clauses))
    .orderBy(desc(integrationSyncConflicts.createdAt))
    .limit(limit);
}

export async function countOpenConflicts(
  organisationId: string,
  connectionKind?: ConnectionKind,
  connectionId?: string,
): Promise<number> {
  const clauses = [
    eq(integrationSyncConflicts.organisationId, organisationId),
    eq(integrationSyncConflicts.status, "open"),
  ];
  if (connectionKind) {
    clauses.push(eq(integrationSyncConflicts.connectionKind, connectionKind));
  }
  if (connectionId) {
    clauses.push(eq(integrationSyncConflicts.connectionId, connectionId));
  }
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(integrationSyncConflicts)
    .where(and(...clauses));
  return Number(row?.n ?? 0);
}

export async function resolveConflict(opts: {
  organisationId: string;
  conflictId: string;
  resolution: Extract<
    ConflictStatus,
    "resolved_keep_kelpie" | "resolved_take_source" | "dismissed"
  >;
  actorId: string | null;
}): Promise<IntegrationSyncConflict> {
  const [conflict] = await db
    .select()
    .from(integrationSyncConflicts)
    .where(
      and(
        eq(integrationSyncConflicts.id, opts.conflictId),
        eq(integrationSyncConflicts.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!conflict) throw new Error("Conflict not found");
  if (conflict.status !== "open") return conflict;

  if (
    opts.resolution === "resolved_take_source" &&
    conflict.caseId &&
    conflict.fieldName
  ) {
    await applyConflictSourceValue(conflict);
  }

  const [updated] = await db
    .update(integrationSyncConflicts)
    .set({
      status: opts.resolution,
      resolvedBy: opts.actorId,
      resolvedAt: new Date(),
    })
    .where(
      and(
        eq(integrationSyncConflicts.id, conflict.id),
        eq(integrationSyncConflicts.organisationId, opts.organisationId),
      ),
    )
    .returning();

  await refreshOpenConflictCount(
    opts.organisationId,
    conflict.connectionKind as ConnectionKind,
    conflict.connectionId,
  );
  return updated!;
}

async function applyConflictSourceValue(
  conflict: IntegrationSyncConflict,
): Promise<void> {
  if (!conflict.caseId) return;
  const field = conflict.fieldName;
  const value = conflict.sourceValue;
  const patch: Record<string, unknown> = {};
  if (field === "title" && typeof value === "string") patch.title = value;
  if (field === "summary" && (typeof value === "string" || value === null)) {
    patch.summary = value;
  }
  if (field === "status" && typeof value === "string") patch.status = value;
  if (field === "severity" && typeof value === "string") patch.severity = value;
  if (field === "classification" && typeof value === "string") {
    patch.classification = value;
  }
  if (field === "assigneeId") patch.assigneeId = value;
  if (Object.keys(patch).length === 0) return;

  await db
    .update(cases)
    .set({
      ...patch,
      version: sql`${cases.version} + 1`,
    })
    .where(
      and(
        eq(cases.id, conflict.caseId),
        eq(cases.organisationId, conflict.organisationId),
      ),
    );
}

async function refreshOpenConflictCount(
  organisationId: string,
  connectionKind: ConnectionKind | string,
  connectionId: string,
): Promise<void> {
  const count = await countOpenConflicts(
    organisationId,
    connectionKind as ConnectionKind,
    connectionId,
  );
  await setOpenConflictCount(
    organisationId,
    connectionKind as ConnectionKind,
    connectionId,
    count,
  );
}
