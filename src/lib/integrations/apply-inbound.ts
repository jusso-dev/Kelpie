/**
 * Apply inbound source field updates to an existing Kelpie case under the
 * per-field ownership policy. Source updates never overwrite Kelpie-owned
 * narrative or fields without an explicit policy that permits it.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cases, type Case } from "@/db/schema";
import { writeTimelineEvent } from "@/lib/timeline";
import { openSyncConflict } from "./conflicts";
import {
  decideInboundField,
  getOrCreateSyncPolicy,
  parseFieldPolicies,
  type FieldPolicyMap,
} from "./sync-policy";
import type { ConnectionKind, SyncField } from "./types";

export type SourceCaseFields = Partial<{
  title: string;
  summary: string | null;
  status: string;
  severity: string;
  classification: string;
  assigneeId: string | null;
  sourceUrl: string | null;
  sourceVersion: string | null;
  sourceUpdatedAt: Date | null;
}>;

export type ApplyInboundResult = {
  caseId: string;
  applied: SyncField[];
  kept: SyncField[];
  conflicts: string[];
  skipped: SyncField[];
  created: boolean;
};

const APPLYABLE: SyncField[] = [
  "title",
  "summary",
  "status",
  "severity",
  "classification",
  "assigneeId",
];

/**
 * Upsert path for a source-linked case: create is handled by the caller via
 * `createCaseCore`; this updates an *existing* case under field ownership.
 */
export async function applyInboundCaseUpdate(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  caseRow: Case;
  source: SourceCaseFields;
  actorId?: string | null;
  sourceProvenance?: string;
}): Promise<ApplyInboundResult> {
  const policy = await getOrCreateSyncPolicy({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
  });
  const fieldPolicies = parseFieldPolicies(policy.fieldPolicies);
  return applyInboundWithPolicies({
    ...opts,
    fieldPolicies,
  });
}

/** Pure-ish path used by tests with an injected policy map (still hits DB for writes). */
export async function applyInboundWithPolicies(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  caseRow: Case;
  source: SourceCaseFields;
  fieldPolicies: FieldPolicyMap;
  actorId?: string | null;
  sourceProvenance?: string;
}): Promise<ApplyInboundResult> {
  const applied: SyncField[] = [];
  const kept: SyncField[] = [];
  const conflicts: string[] = [];
  const skipped: SyncField[] = [];
  const patch: Record<string, unknown> = {};
  const sourceUpdatedAt = opts.source.sourceUpdatedAt ?? null;
  const caseUpdatedAt = opts.caseRow.lastActivityAt ?? opts.caseRow.openedAt;
  const sourceIsNewer =
    !sourceUpdatedAt || !caseUpdatedAt
      ? true
      : sourceUpdatedAt.getTime() >= caseUpdatedAt.getTime();

  for (const field of APPLYABLE) {
    if (!(field in opts.source) || opts.source[field as keyof SourceCaseFields] === undefined) {
      continue;
    }
    const sourceValue = opts.source[field as keyof SourceCaseFields];
    const kelpieValue = readCaseField(opts.caseRow, field);
    const ownership = opts.fieldPolicies[field] ?? "kelpie_owned";
    const decision = decideInboundField({
      ownership,
      kelpieValue,
      sourceValue,
      sourceIsNewer,
    });

    if (decision.action === "apply_source") {
      patch[caseColumn(field)] = sourceValue;
      applied.push(field);
    } else if (decision.action === "keep_kelpie") {
      kept.push(field);
    } else if (decision.action === "skip_one_way") {
      skipped.push(field);
    } else if (decision.action === "conflict") {
      const conflict = await openSyncConflict({
        organisationId: opts.organisationId,
        connectionKind: opts.connectionKind,
        connectionId: opts.connectionId,
        caseId: opts.caseRow.id,
        fieldName: field,
        kelpieValue,
        sourceValue,
        kelpieUpdatedAt: caseUpdatedAt,
        sourceUpdatedAt,
        kelpieProvenance: "kelpie",
        sourceProvenance: opts.sourceProvenance ?? opts.connectionKind,
      });
      conflicts.push(conflict.id);
    }
  }

  if (opts.source.sourceUrl && opts.source.sourceUrl !== opts.caseRow.sourceUrl) {
    // sourceUrl is always source-owned metadata.
    patch.sourceUrl = opts.source.sourceUrl;
  }

  if (Object.keys(patch).length > 0) {
    await db
      .update(cases)
      .set({
        ...patch,
        version: sql`${cases.version} + 1`,
      })
      .where(
        and(
          eq(cases.id, opts.caseRow.id),
          eq(cases.organisationId, opts.organisationId),
        ),
      );
    if (applied.length > 0) {
      await writeTimelineEvent({
        caseId: opts.caseRow.id,
        actorId: opts.actorId ?? null,
        eventType: "source_sync",
        payload: {
          connection_kind: opts.connectionKind,
          connection_id: opts.connectionId,
          applied,
          kept,
          conflicts: conflicts.length,
        },
      }).catch(() => {
        // Timeline is best-effort for sync; case row already updated.
      });
    }
  }

  return {
    caseId: opts.caseRow.id,
    applied,
    kept,
    conflicts,
    skipped,
    created: false,
  };
}

function readCaseField(row: Case, field: SyncField): unknown {
  switch (field) {
    case "title":
      return row.title;
    case "summary":
      return row.summary;
    case "status":
      return row.status;
    case "severity":
      return row.severity;
    case "classification":
      return row.classification;
    case "assigneeId":
      return row.assigneeId;
    default:
      return null;
  }
}

function caseColumn(field: SyncField): string {
  switch (field) {
    case "assigneeId":
      return "assigneeId";
    default:
      return field;
  }
}
