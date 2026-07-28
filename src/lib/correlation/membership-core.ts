/**
 * Analyst-governed alert membership operations (issue #56): attach, move,
 * create-case-from-alerts, merge, split, reverse-merge. Every mutation requires
 * a reason, is organisation-scoped, records immutable membership history,
 * writes case timeline events, and supports optimistic version checks on
 * cases involved.
 *
 * Case merge never deletes source cases — they are marked superseded via
 * `cases.supersededByCaseId` and remain navigable. Reverse is available until
 * the merge's `reverseDeadline` when no incompatible mutation blocks it.
 */

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  alertMembershipHistory,
  alerts,
  caseAlerts,
  caseMerges,
  cases,
  evidenceItems,
  organisations,
  type Alert,
  type Case,
  type CaseMerge,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { createCaseCore } from "@/lib/cases-core";
import { recordAuditEvent } from "@/lib/audit/events";
import { parseCorrelationPolicy } from "./policy";

export class CorrelationError extends Error {
  status: number;
  details?: Record<string, unknown>;
  constructor(
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CorrelationError";
    this.status = status;
    this.details = details;
  }
}

export class CorrelationVersionConflictError extends CorrelationError {
  current: Record<string, unknown>;
  constructor(current: Record<string, unknown>) {
    super("version_conflict", 409, { current });
    this.name = "CorrelationVersionConflictError";
    this.current = current;
  }
}

function requireReason(reason: string | undefined | null): string {
  const trimmed = (reason ?? "").trim();
  if (!trimmed) {
    throw new CorrelationError("A reason is required for this operation");
  }
  return trimmed;
}

async function loadCaseInOrg(
  caseId: string,
  organisationId: string,
): Promise<Case | null> {
  const [row] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

async function loadAlertsInOrg(
  alertIds: string[],
  organisationId: string,
): Promise<Alert[]> {
  if (alertIds.length === 0) return [];
  return db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.organisationId, organisationId),
        inArray(alerts.id, alertIds),
      ),
    );
}

function assertAllFound<T extends { id: string }>(
  requested: string[],
  found: T[],
  label: string,
): void {
  if (found.length !== new Set(requested).size) {
    throw new CorrelationError(`${label} not found`, 404);
  }
}

function assertNotSuperseded(caseRow: Case): void {
  if (caseRow.supersededByCaseId) {
    throw new CorrelationError(
      "Case has been superseded by a merge; operate on the canonical case instead",
      409,
      {
        supersededByCaseId: caseRow.supersededByCaseId,
        caseId: caseRow.id,
        version: caseRow.version,
      },
    );
  }
}

function checkCaseVersions(
  rows: Case[],
  expected?: Record<string, number>,
): void {
  if (!expected) return;
  for (const [caseId, version] of Object.entries(expected)) {
    const row = rows.find((r) => r.id === caseId);
    if (!row) {
      throw new CorrelationError("Case not found", 404);
    }
    if (row.version !== version) {
      throw new CorrelationVersionConflictError({
        caseId: row.id,
        version: row.version,
        title: row.title,
        caseNumber: row.caseNumber,
        status: row.status,
        supersededByCaseId: row.supersededByCaseId,
      });
    }
  }
}

async function recordMembership(opts: {
  organisationId: string;
  alertId: string;
  operation:
    | "link"
    | "unlink"
    | "move"
    | "merge"
    | "split"
    | "create_case"
    | "reverse_merge";
  fromCaseId: string | null;
  toCaseId: string | null;
  reason: string;
  actorId: string | null;
  operationId: string;
  suggestionId?: string | null;
  mergeId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(alertMembershipHistory).values({
    id: newId("amh"),
    organisationId: opts.organisationId,
    alertId: opts.alertId,
    operation: opts.operation,
    fromCaseId: opts.fromCaseId,
    toCaseId: opts.toCaseId,
    reason: opts.reason,
    actorId: opts.actorId,
    operationId: opts.operationId,
    suggestionId: opts.suggestionId ?? null,
    mergeId: opts.mergeId ?? null,
    metadata: opts.metadata ?? {},
  });
}

async function moveEvidenceForAlerts(opts: {
  organisationId: string;
  alertIds: string[];
  toCaseId: string;
}): Promise<number> {
  if (opts.alertIds.length === 0) return 0;
  const updated = await db
    .update(evidenceItems)
    .set({ caseId: opts.toCaseId, updatedAt: new Date() })
    .where(
      and(
        eq(evidenceItems.organisationId, opts.organisationId),
        inArray(evidenceItems.alertId, opts.alertIds),
      ),
    )
    .returning({ id: evidenceItems.id });
  return updated.length;
}

async function unlinkAlertFromCase(opts: {
  organisationId: string;
  caseId: string;
  alertId: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(caseAlerts)
    .where(
      and(
        eq(caseAlerts.organisationId, opts.organisationId),
        eq(caseAlerts.caseId, opts.caseId),
        eq(caseAlerts.alertId, opts.alertId),
      ),
    )
    .returning({ id: caseAlerts.id });
  return deleted.length > 0;
}

async function linkAlertToCaseSilent(opts: {
  organisationId: string;
  caseId: string;
  alertId: string;
  actorId: string | null;
  isPrimary?: boolean;
}): Promise<boolean> {
  const [inserted] = await db
    .insert(caseAlerts)
    .values({
      id: newId("calert"),
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      alertId: opts.alertId,
      isPrimary: opts.isPrimary ?? false,
      addedBy: opts.actorId,
    })
    .onConflictDoNothing()
    .returning();
  return Boolean(inserted);
}

async function loadOrgPolicy(organisationId: string) {
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return parseCorrelationPolicy(org?.settings);
}

/* ── attach ─────────────────────────────────────────────────────────────── */

export async function attachAlertsToCaseCore(opts: {
  organisationId: string;
  actorId: string | null;
  caseId: string;
  alertIds: string[];
  reason: string;
  expectedVersions?: Record<string, number>;
  suggestionId?: string | null;
}): Promise<{ operationId: string; attachedAlertIds: string[] }> {
  const reason = requireReason(opts.reason);
  if (opts.alertIds.length === 0) {
    throw new CorrelationError("At least one alert id is required");
  }

  const caseRow = await loadCaseInOrg(opts.caseId, opts.organisationId);
  if (!caseRow) throw new CorrelationError("Case not found", 404);
  assertNotSuperseded(caseRow);
  checkCaseVersions([caseRow], opts.expectedVersions);

  const alertRows = await loadAlertsInOrg(opts.alertIds, opts.organisationId);
  assertAllFound(opts.alertIds, alertRows, "Alert");

  const operationId = newId("corrop");
  const attached: string[] = [];

  for (const alert of alertRows) {
    const inserted = await linkAlertToCaseSilent({
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      alertId: alert.id,
      actorId: opts.actorId,
    });
    if (inserted) {
      attached.push(alert.id);
      await recordMembership({
        organisationId: opts.organisationId,
        alertId: alert.id,
        operation: "link",
        fromCaseId: null,
        toCaseId: opts.caseId,
        reason,
        actorId: opts.actorId,
        operationId,
        suggestionId: opts.suggestionId,
      });
      await writeTimelineEvent({
        caseId: opts.caseId,
        actorId: opts.actorId,
        eventType: "alert_linked_to_case",
        payload: {
          alert_id: alert.id,
          title: alert.title,
          reason,
          operation_id: operationId,
          correlation: true,
        },
      });
    }
  }

  await bumpCaseVersion(opts.caseId);
  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.alerts_attached",
    targetType: "case",
    targetId: opts.caseId,
    targetLabel: caseRow.caseNumber,
    metadata: {
      alert_ids: attached,
      reason,
      operation_id: operationId,
      suggestion_id: opts.suggestionId ?? null,
    },
  });

  return { operationId, attachedAlertIds: attached };
}

async function bumpCaseVersion(caseId: string): Promise<void> {
  await db
    .update(cases)
    .set({ version: sql`${cases.version} + 1` })
    .where(eq(cases.id, caseId));
}

/* ── move ───────────────────────────────────────────────────────────────── */

export async function moveAlertsCore(opts: {
  organisationId: string;
  actorId: string | null;
  alertIds: string[];
  fromCaseId: string;
  toCaseId: string;
  reason: string;
  expectedVersions?: Record<string, number>;
  suggestionId?: string | null;
}): Promise<{ operationId: string; movedAlertIds: string[] }> {
  const reason = requireReason(opts.reason);
  if (opts.alertIds.length === 0) {
    throw new CorrelationError("At least one alert id is required");
  }
  if (opts.fromCaseId === opts.toCaseId) {
    throw new CorrelationError("Source and destination cases must differ");
  }

  const [fromCase, toCase] = await Promise.all([
    loadCaseInOrg(opts.fromCaseId, opts.organisationId),
    loadCaseInOrg(opts.toCaseId, opts.organisationId),
  ]);
  if (!fromCase) throw new CorrelationError("Source case not found", 404);
  if (!toCase) throw new CorrelationError("Destination case not found", 404);
  assertNotSuperseded(fromCase);
  assertNotSuperseded(toCase);
  checkCaseVersions([fromCase, toCase], opts.expectedVersions);

  const alertRows = await loadAlertsInOrg(opts.alertIds, opts.organisationId);
  assertAllFound(opts.alertIds, alertRows, "Alert");

  // Confirm each alert is currently linked to fromCase.
  const links = await db
    .select({ alertId: caseAlerts.alertId })
    .from(caseAlerts)
    .where(
      and(
        eq(caseAlerts.organisationId, opts.organisationId),
        eq(caseAlerts.caseId, opts.fromCaseId),
        inArray(caseAlerts.alertId, opts.alertIds),
      ),
    );
  if (links.length !== opts.alertIds.length) {
    throw new CorrelationError(
      "One or more alerts are not members of the source case",
      409,
    );
  }

  const operationId = newId("corrop");
  const moved: string[] = [];

  for (const alert of alertRows) {
    await unlinkAlertFromCase({
      organisationId: opts.organisationId,
      caseId: opts.fromCaseId,
      alertId: alert.id,
    });
    await linkAlertToCaseSilent({
      organisationId: opts.organisationId,
      caseId: opts.toCaseId,
      alertId: alert.id,
      actorId: opts.actorId,
    });
    moved.push(alert.id);
    await recordMembership({
      organisationId: opts.organisationId,
      alertId: alert.id,
      operation: "move",
      fromCaseId: opts.fromCaseId,
      toCaseId: opts.toCaseId,
      reason,
      actorId: opts.actorId,
      operationId,
      suggestionId: opts.suggestionId,
    });
    await writeTimelineEvent({
      caseId: opts.fromCaseId,
      actorId: opts.actorId,
      eventType: "alert_unlinked_from_case",
      payload: {
        alert_id: alert.id,
        title: alert.title,
        reason,
        operation_id: operationId,
        moved_to_case_id: opts.toCaseId,
        correlation: true,
      },
    });
    await writeTimelineEvent({
      caseId: opts.toCaseId,
      actorId: opts.actorId,
      eventType: "alert_linked_to_case",
      payload: {
        alert_id: alert.id,
        title: alert.title,
        reason,
        operation_id: operationId,
        moved_from_case_id: opts.fromCaseId,
        correlation: true,
      },
    });
  }

  await moveEvidenceForAlerts({
    organisationId: opts.organisationId,
    alertIds: moved,
    toCaseId: opts.toCaseId,
  });

  await Promise.all([
    bumpCaseVersion(opts.fromCaseId),
    bumpCaseVersion(opts.toCaseId),
  ]);

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.alerts_moved",
    targetType: "case",
    targetId: opts.toCaseId,
    targetLabel: toCase.caseNumber,
    metadata: {
      from_case_id: opts.fromCaseId,
      to_case_id: opts.toCaseId,
      alert_ids: moved,
      reason,
      operation_id: operationId,
    },
  });

  return { operationId, movedAlertIds: moved };
}

/* ── create case from alerts ────────────────────────────────────────────── */

export async function createCaseFromAlertsCore(opts: {
  organisationId: string;
  actorId: string | null;
  alertIds: string[];
  reason: string;
  title?: string;
  expectedVersions?: Record<string, number>;
  suggestionId?: string | null;
}): Promise<{
  operationId: string;
  caseId: string;
  caseNumber: string;
  movedAlertIds: string[];
}> {
  const reason = requireReason(opts.reason);
  if (opts.alertIds.length === 0) {
    throw new CorrelationError("At least one alert id is required");
  }

  const alertRows = await loadAlertsInOrg(opts.alertIds, opts.organisationId);
  assertAllFound(opts.alertIds, alertRows, "Alert");

  // Current memberships of these alerts (for move-out).
  const memberships = await db
    .select({
      alertId: caseAlerts.alertId,
      caseId: caseAlerts.caseId,
    })
    .from(caseAlerts)
    .where(
      and(
        eq(caseAlerts.organisationId, opts.organisationId),
        inArray(caseAlerts.alertId, opts.alertIds),
      ),
    );

  const involvedCaseIds = [...new Set(memberships.map((m) => m.caseId))];
  const involvedCases =
    involvedCaseIds.length === 0
      ? []
      : await db
          .select()
          .from(cases)
          .where(
            and(
              eq(cases.organisationId, opts.organisationId),
              inArray(cases.id, involvedCaseIds),
            ),
          );
  for (const c of involvedCases) assertNotSuperseded(c);
  checkCaseVersions(involvedCases, opts.expectedVersions);

  const title =
    opts.title?.trim() ||
    (alertRows.length === 1
      ? alertRows[0]!.title
      : `Investigation from ${alertRows.length} alerts`);

  const created = await createCaseCore(opts.organisationId, opts.actorId, {
    title,
    summary: reason,
  });
  const operationId = newId("corrop");
  const moved: string[] = [];
  const membershipByAlert = new Map(
    memberships.map((m) => [m.alertId, m.caseId]),
  );

  for (const alert of alertRows) {
    const fromCaseId = membershipByAlert.get(alert.id) ?? null;
    if (fromCaseId) {
      await unlinkAlertFromCase({
        organisationId: opts.organisationId,
        caseId: fromCaseId,
        alertId: alert.id,
      });
      await writeTimelineEvent({
        caseId: fromCaseId,
        actorId: opts.actorId,
        eventType: "alert_unlinked_from_case",
        payload: {
          alert_id: alert.id,
          title: alert.title,
          reason,
          operation_id: operationId,
          moved_to_case_id: created.id,
          correlation: true,
        },
      });
    }
    await linkAlertToCaseSilent({
      organisationId: opts.organisationId,
      caseId: created.id,
      alertId: alert.id,
      actorId: opts.actorId,
      isPrimary: moved.length === 0,
    });
    moved.push(alert.id);
    await recordMembership({
      organisationId: opts.organisationId,
      alertId: alert.id,
      operation: fromCaseId ? "split" : "create_case",
      fromCaseId,
      toCaseId: created.id,
      reason,
      actorId: opts.actorId,
      operationId,
      suggestionId: opts.suggestionId,
    });
    await writeTimelineEvent({
      caseId: created.id,
      actorId: opts.actorId,
      eventType: "alert_linked_to_case",
      payload: {
        alert_id: alert.id,
        title: alert.title,
        reason,
        operation_id: operationId,
        correlation: true,
      },
    });
  }

  await moveEvidenceForAlerts({
    organisationId: opts.organisationId,
    alertIds: moved,
    toCaseId: created.id,
  });

  for (const caseId of involvedCaseIds) {
    await bumpCaseVersion(caseId);
  }
  await bumpCaseVersion(created.id);

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.case_created_from_alerts",
    targetType: "case",
    targetId: created.id,
    targetLabel: created.caseNumber,
    metadata: {
      alert_ids: moved,
      reason,
      operation_id: operationId,
      from_case_ids: involvedCaseIds,
    },
  });

  return {
    operationId,
    caseId: created.id,
    caseNumber: created.caseNumber,
    movedAlertIds: moved,
  };
}

/* ── split (selected alerts → new case) ─────────────────────────────────── */

export async function splitAlertsCore(opts: {
  organisationId: string;
  actorId: string | null;
  fromCaseId: string;
  alertIds: string[];
  reason: string;
  title?: string;
  expectedVersions?: Record<string, number>;
}): Promise<{
  operationId: string;
  caseId: string;
  caseNumber: string;
  movedAlertIds: string[];
}> {
  const reason = requireReason(opts.reason);
  if (opts.alertIds.length === 0) {
    throw new CorrelationError("At least one alert id is required");
  }

  const fromCase = await loadCaseInOrg(opts.fromCaseId, opts.organisationId);
  if (!fromCase) throw new CorrelationError("Source case not found", 404);
  assertNotSuperseded(fromCase);
  checkCaseVersions([fromCase], opts.expectedVersions);

  // All selected alerts must currently belong to fromCase.
  const links = await db
    .select({ alertId: caseAlerts.alertId })
    .from(caseAlerts)
    .where(
      and(
        eq(caseAlerts.organisationId, opts.organisationId),
        eq(caseAlerts.caseId, opts.fromCaseId),
        inArray(caseAlerts.alertId, opts.alertIds),
      ),
    );
  if (links.length !== opts.alertIds.length) {
    throw new CorrelationError(
      "One or more alerts are not members of the source case",
      409,
    );
  }

  // Refuse to leave the source case with zero alerts if that would orphan it
  // silently — split of *all* alerts is still allowed (analysts may empty a
  // case deliberately); no hard block.

  return createCaseFromAlertsCore({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    alertIds: opts.alertIds,
    reason,
    title: opts.title,
    expectedVersions: opts.expectedVersions,
  });
}

/* ── merge cases ────────────────────────────────────────────────────────── */

export async function mergeCasesCore(opts: {
  organisationId: string;
  actorId: string | null;
  canonicalCaseId: string;
  sourceCaseIds: string[];
  reason: string;
  expectedVersions?: Record<string, number>;
  suggestionId?: string | null;
  /** Only set true by the auto-apply path after policy checks. */
  autoApplied?: boolean;
}): Promise<{ merge: CaseMerge; operationId: string; movedAlertIds: string[] }> {
  const reason = requireReason(opts.reason);
  const sourceIds = [...new Set(opts.sourceCaseIds)].filter(
    (id) => id !== opts.canonicalCaseId,
  );
  if (sourceIds.length === 0) {
    throw new CorrelationError("At least one distinct source case is required");
  }

  const allIds = [opts.canonicalCaseId, ...sourceIds];
  const caseRows = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.organisationId, opts.organisationId),
        inArray(cases.id, allIds),
      ),
    );
  assertAllFound(allIds, caseRows, "Case");
  for (const c of caseRows) assertNotSuperseded(c);
  checkCaseVersions(caseRows, opts.expectedVersions);

  const canonical = caseRows.find((c) => c.id === opts.canonicalCaseId)!;
  const policy = await loadOrgPolicy(opts.organisationId);

  if (opts.autoApplied && !policy.autoMergeEnabled) {
    throw new CorrelationError(
      "Automatic merge is disabled by organisation policy",
      403,
    );
  }

  // Collect alerts currently on source cases.
  const sourceLinks = await db
    .select({
      alertId: caseAlerts.alertId,
      caseId: caseAlerts.caseId,
      isPrimary: caseAlerts.isPrimary,
    })
    .from(caseAlerts)
    .where(
      and(
        eq(caseAlerts.organisationId, opts.organisationId),
        inArray(caseAlerts.caseId, sourceIds),
      ),
    );

  const alertIds = [...new Set(sourceLinks.map((l) => l.alertId))];
  const alertRows =
    alertIds.length === 0
      ? []
      : await loadAlertsInOrg(alertIds, opts.organisationId);
  const alertById = new Map(alertRows.map((a) => [a.id, a]));

  const operationId = newId("corrop");
  const mergeId = newId("cmerge");
  const reverseDeadline = new Date(
    Date.now() + policy.mergeSafetyWindowHours * 60 * 60 * 1000,
  );
  const caseVersions: Record<string, number> = {};
  for (const c of caseRows) caseVersions[c.id] = c.version;

  const alertOriginById: Record<string, string> = {};
  for (const link of sourceLinks) {
    alertOriginById[link.alertId] = link.caseId;
  }

  const moved: string[] = [];
  for (const link of sourceLinks) {
    const alert = alertById.get(link.alertId);
    await unlinkAlertFromCase({
      organisationId: opts.organisationId,
      caseId: link.caseId,
      alertId: link.alertId,
    });
    await linkAlertToCaseSilent({
      organisationId: opts.organisationId,
      caseId: opts.canonicalCaseId,
      alertId: link.alertId,
      actorId: opts.actorId,
    });
    moved.push(link.alertId);
    await recordMembership({
      organisationId: opts.organisationId,
      alertId: link.alertId,
      operation: "merge",
      fromCaseId: link.caseId,
      toCaseId: opts.canonicalCaseId,
      reason,
      actorId: opts.actorId,
      operationId,
      suggestionId: opts.suggestionId,
      mergeId,
    });
    await writeTimelineEvent({
      caseId: link.caseId,
      actorId: opts.actorId,
      eventType: "alert_unlinked_from_case",
      payload: {
        alert_id: link.alertId,
        title: alert?.title,
        reason,
        operation_id: operationId,
        merge_id: mergeId,
        moved_to_case_id: opts.canonicalCaseId,
        correlation: true,
      },
    });
    await writeTimelineEvent({
      caseId: opts.canonicalCaseId,
      actorId: opts.actorId,
      eventType: "alert_linked_to_case",
      payload: {
        alert_id: link.alertId,
        title: alert?.title,
        reason,
        operation_id: operationId,
        merge_id: mergeId,
        moved_from_case_id: link.caseId,
        correlation: true,
      },
    });
  }

  await moveEvidenceForAlerts({
    organisationId: opts.organisationId,
    alertIds: moved,
    toCaseId: opts.canonicalCaseId,
  });

  // Mark sources superseded — never delete.
  for (const sourceId of sourceIds) {
    await db
      .update(cases)
      .set({
        supersededByCaseId: opts.canonicalCaseId,
        version: sql`${cases.version} + 1`,
      })
      .where(
        and(
          eq(cases.id, sourceId),
          eq(cases.organisationId, opts.organisationId),
        ),
      );
    await writeTimelineEvent({
      caseId: sourceId,
      actorId: opts.actorId,
      eventType: "case_merged",
      payload: {
        merge_id: mergeId,
        role: "source",
        canonical_case_id: opts.canonicalCaseId,
        reason,
        operation_id: operationId,
        reverse_deadline: reverseDeadline.toISOString(),
      },
    });
  }

  await bumpCaseVersion(opts.canonicalCaseId);
  await writeTimelineEvent({
    caseId: opts.canonicalCaseId,
    actorId: opts.actorId,
    eventType: "case_merged",
    payload: {
      merge_id: mergeId,
      role: "canonical",
      source_case_ids: sourceIds,
      reason,
      operation_id: operationId,
      alert_ids: moved,
      reverse_deadline: reverseDeadline.toISOString(),
      auto_applied: opts.autoApplied === true,
    },
  });

  const [merge] = await db
    .insert(caseMerges)
    .values({
      id: mergeId,
      organisationId: opts.organisationId,
      canonicalCaseId: opts.canonicalCaseId,
      sourceCaseIds: sourceIds,
      movedAlertIds: moved,
      alertOriginById,
      reason,
      actorId: opts.actorId,
      status: "active",
      suggestionId: opts.suggestionId ?? null,
      reverseDeadline,
      caseVersions,
    })
    .returning();

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.cases_merged",
    targetType: "case",
    targetId: opts.canonicalCaseId,
    targetLabel: canonical.caseNumber,
    metadata: {
      merge_id: mergeId,
      source_case_ids: sourceIds,
      alert_ids: moved,
      reason,
      operation_id: operationId,
      auto_applied: opts.autoApplied === true,
      reverse_deadline: reverseDeadline.toISOString(),
    },
  });

  return { merge: merge!, operationId, movedAlertIds: moved };
}

/* ── reverse merge ──────────────────────────────────────────────────────── */

export async function reverseMergeCore(opts: {
  organisationId: string;
  actorId: string | null;
  mergeId: string;
  reason: string;
  expectedVersions?: Record<string, number>;
}): Promise<{ operationId: string; restoredAlertIds: string[] }> {
  const reason = requireReason(opts.reason);

  const [merge] = await db
    .select()
    .from(caseMerges)
    .where(
      and(
        eq(caseMerges.id, opts.mergeId),
        eq(caseMerges.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!merge) throw new CorrelationError("Merge not found", 404);
  if (merge.status !== "active") {
    throw new CorrelationError("Merge has already been reversed", 409);
  }
  if (merge.reverseDeadline.getTime() < Date.now()) {
    throw new CorrelationError(
      "Merge safety window has expired; reverse is no longer allowed",
      409,
      { reverseDeadline: merge.reverseDeadline.toISOString() },
    );
  }

  const sourceCaseIds = Array.isArray(merge.sourceCaseIds)
    ? (merge.sourceCaseIds as string[])
    : [];
  const movedAlertIds = Array.isArray(merge.movedAlertIds)
    ? (merge.movedAlertIds as string[])
    : [];
  const originById =
    merge.alertOriginById && typeof merge.alertOriginById === "object"
      ? (merge.alertOriginById as Record<string, string>)
      : {};

  const allCaseIds = [merge.canonicalCaseId, ...sourceCaseIds];
  const caseRows = await db
    .select()
    .from(cases)
    .where(
      and(
        eq(cases.organisationId, opts.organisationId),
        inArray(cases.id, allCaseIds),
      ),
    );
  checkCaseVersions(caseRows, opts.expectedVersions);

  // Incompatible mutation: a moved alert is no longer on the canonical case
  // (someone moved it elsewhere after the merge).
  if (movedAlertIds.length > 0) {
    const stillOnCanonical = await db
      .select({ alertId: caseAlerts.alertId })
      .from(caseAlerts)
      .where(
        and(
          eq(caseAlerts.organisationId, opts.organisationId),
          eq(caseAlerts.caseId, merge.canonicalCaseId),
          inArray(caseAlerts.alertId, movedAlertIds),
        ),
      );
    const stillSet = new Set(stillOnCanonical.map((r) => r.alertId));
    const missing = movedAlertIds.filter((id) => !stillSet.has(id));
    if (missing.length > 0) {
      throw new CorrelationError(
        "Merge cannot be reversed: one or more merged alerts were moved after the merge",
        409,
        { alertIds: missing },
      );
    }
  }

  // Sources must still point at the canonical (not re-merged elsewhere).
  for (const sourceId of sourceCaseIds) {
    const row = caseRows.find((c) => c.id === sourceId);
    if (!row) {
      throw new CorrelationError(
        "Merge cannot be reversed: a source case is missing",
        409,
      );
    }
    if (row.supersededByCaseId !== merge.canonicalCaseId) {
      throw new CorrelationError(
        "Merge cannot be reversed: a source case is no longer superseded by the canonical case",
        409,
        { caseId: sourceId, supersededByCaseId: row.supersededByCaseId },
      );
    }
  }

  const operationId = newId("corrop");
  const restored: string[] = [];

  for (const alertId of movedAlertIds) {
    const originCaseId = originById[alertId];
    if (!originCaseId) continue;
    await unlinkAlertFromCase({
      organisationId: opts.organisationId,
      caseId: merge.canonicalCaseId,
      alertId,
    });
    await linkAlertToCaseSilent({
      organisationId: opts.organisationId,
      caseId: originCaseId,
      alertId,
      actorId: opts.actorId,
    });
    await moveEvidenceForAlerts({
      organisationId: opts.organisationId,
      alertIds: [alertId],
      toCaseId: originCaseId,
    });
    restored.push(alertId);
    await recordMembership({
      organisationId: opts.organisationId,
      alertId,
      operation: "reverse_merge",
      fromCaseId: merge.canonicalCaseId,
      toCaseId: originCaseId,
      reason,
      actorId: opts.actorId,
      operationId,
      mergeId: merge.id,
    });
    await writeTimelineEvent({
      caseId: merge.canonicalCaseId,
      actorId: opts.actorId,
      eventType: "alert_unlinked_from_case",
      payload: {
        alert_id: alertId,
        reason,
        operation_id: operationId,
        merge_id: merge.id,
        reverse_merge: true,
      },
    });
    await writeTimelineEvent({
      caseId: originCaseId,
      actorId: opts.actorId,
      eventType: "alert_linked_to_case",
      payload: {
        alert_id: alertId,
        reason,
        operation_id: operationId,
        merge_id: merge.id,
        reverse_merge: true,
      },
    });
  }

  for (const sourceId of sourceCaseIds) {
    await db
      .update(cases)
      .set({
        supersededByCaseId: null,
        version: sql`${cases.version} + 1`,
      })
      .where(eq(cases.id, sourceId));
    await writeTimelineEvent({
      caseId: sourceId,
      actorId: opts.actorId,
      eventType: "case_merge_reversed",
      payload: {
        merge_id: merge.id,
        role: "source",
        canonical_case_id: merge.canonicalCaseId,
        reason,
        operation_id: operationId,
      },
    });
  }

  await bumpCaseVersion(merge.canonicalCaseId);
  await writeTimelineEvent({
    caseId: merge.canonicalCaseId,
    actorId: opts.actorId,
    eventType: "case_merge_reversed",
    payload: {
      merge_id: merge.id,
      role: "canonical",
      source_case_ids: sourceCaseIds,
      reason,
      operation_id: operationId,
      restored_alert_ids: restored,
    },
  });

  await db
    .update(caseMerges)
    .set({
      status: "reversed",
      reversedAt: new Date(),
      reversedBy: opts.actorId,
      reverseReason: reason,
    })
    .where(eq(caseMerges.id, merge.id));

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.merge_reversed",
    targetType: "case",
    targetId: merge.canonicalCaseId,
    metadata: {
      merge_id: merge.id,
      source_case_ids: sourceCaseIds,
      restored_alert_ids: restored,
      reason,
      operation_id: operationId,
    },
  });

  return { operationId, restoredAlertIds: restored };
}

export async function getMergeInOrg(
  mergeId: string,
  organisationId: string,
): Promise<CaseMerge | null> {
  const [row] = await db
    .select()
    .from(caseMerges)
    .where(
      and(
        eq(caseMerges.id, mergeId),
        eq(caseMerges.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listMembershipHistoryForAlert(opts: {
  organisationId: string;
  alertId: string;
}): Promise<(typeof alertMembershipHistory.$inferSelect)[]> {
  return db
    .select()
    .from(alertMembershipHistory)
    .where(
      and(
        eq(alertMembershipHistory.organisationId, opts.organisationId),
        eq(alertMembershipHistory.alertId, opts.alertId),
      ),
    )
    .orderBy(desc(alertMembershipHistory.createdAt));
}
