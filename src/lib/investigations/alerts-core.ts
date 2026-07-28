/**
 * Core alert mutations and queries (issue #55). Callers must already have
 * resolved `organisationId`; every function re-verifies that every id it
 * touches belongs to that organisation, following the same pattern as
 * `case-relationships-core` and `lib/evidence/core`.
 *
 * Field ownership (see the comment block above the table definitions in
 * `src/db/schema.ts`):
 *   - `createOrUpdateAlertFromProviderCore` only ever writes provider-owned
 *     columns, and skips `severity` once an analyst has overridden it.
 *   - `setAlertDispositionCore` only ever writes analyst-owned columns
 *     (`status`, `determination`, `severity` + the override flag,
 *     `assigneeId`, `analystNotes`, `dismissedReason`) and is the only path
 *     that can change them — a provider poll can never touch them.
 */

import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  alertEntities,
  alertSources,
  alerts,
  caseAlerts,
  cases,
  entities,
  type Alert,
  type AlertEntity,
  type AlertSource,
  type CaseAlert,
  type Entity,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  type KeysetCursor,
  type ListPage,
} from "./pagination";

export class AlertError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "AlertError";
    this.status = status;
  }
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function getAlertInOrg(
  alertId: string,
  organisationId: string,
): Promise<Alert | null> {
  const [row] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.organisationId, organisationId)))
    .limit(1);
  return row ?? null;
}

/** Get-or-create an alert-producer registration, deduplicated by (org, kind, tenant). */
export async function getOrCreateAlertSourceCore(input: {
  organisationId: string;
  kind: string;
  name: string;
  tenantId?: string | null;
  config?: Record<string, unknown>;
  createdBy?: string | null;
}): Promise<AlertSource> {
  const tenantId = input.tenantId ?? "";
  const [inserted] = await db
    .insert(alertSources)
    .values({
      id: newId("alsrc"),
      organisationId: input.organisationId,
      kind: input.kind,
      name: input.name,
      tenantId,
      config: input.config ?? {},
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const [existing] = await db
    .select()
    .from(alertSources)
    .where(
      and(
        eq(alertSources.organisationId, input.organisationId),
        eq(alertSources.kind, input.kind),
        eq(alertSources.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!existing) throw new AlertError("Alert source could not be resolved", 500);
  return existing;
}

export type ProviderAlertInput = {
  organisationId: string;
  sourceId: string;
  tenantId?: string | null;
  externalId: string;
  title: string;
  description?: string | null;
  detectionSource?: string | null;
  detectionProduct?: string | null;
  classification?: string | null;
  severity?: Alert["severity"];
  detectedAt?: Date | null;
  providerCreatedAt?: Date | null;
  providerUpdatedAt?: Date | null;
  sourceUrl?: string | null;
  normalizedFields?: Record<string, unknown>;
  attackTechniques?: string[];
  rawPayloadRefId?: string | null;
};

/**
 * Idempotent ingestion: `(organisationId, sourceId, tenantId, externalId)` is
 * unique, so re-polling the same source never creates a duplicate alert. On
 * an existing alert, only provider-owned columns are refreshed — analyst
 * disposition (status/determination/assignee/notes) is left untouched, and
 * `severity` is skipped once `severityOverriddenByAnalyst` is set.
 */
export async function createOrUpdateAlertFromProviderCore(
  input: ProviderAlertInput,
): Promise<{ alert: Alert; created: boolean }> {
  if (!input.title.trim()) throw new AlertError("Alert title is required");
  if (!input.externalId.trim()) throw new AlertError("Alert externalId is required");

  // The foreign key only proves the source exists somewhere, not that it
  // belongs to this organisation. Today every caller resolves `sourceId`
  // through an org-scoped helper, but this function is the intended entry
  // point for future provider-polling endpoints, so it verifies ownership
  // itself rather than trusting its callers to keep doing so.
  const [source] = await db
    .select({ id: alertSources.id })
    .from(alertSources)
    .where(
      and(
        eq(alertSources.id, input.sourceId),
        eq(alertSources.organisationId, input.organisationId),
      ),
    )
    .limit(1);
  if (!source) throw new AlertError("Alert source not found", 404);

  const tenantId = input.tenantId ?? "";

  const providerFields = {
    title: input.title.trim(),
    description: input.description ?? null,
    detectionSource: input.detectionSource ?? null,
    detectionProduct: input.detectionProduct ?? null,
    classification: input.classification ?? null,
    detectedAt: input.detectedAt ?? null,
    providerCreatedAt: input.providerCreatedAt ?? null,
    providerUpdatedAt: input.providerUpdatedAt ?? null,
    sourceUrl: input.sourceUrl ?? null,
    normalizedFields: input.normalizedFields ?? {},
    attackTechniques: input.attackTechniques ?? [],
    rawPayloadRefId: input.rawPayloadRefId ?? null,
  };

  const [existing] = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.organisationId, input.organisationId),
        eq(alerts.sourceId, input.sourceId),
        eq(alerts.tenantId, tenantId),
        eq(alerts.externalId, input.externalId),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(alerts)
      .set({
        ...providerFields,
        severity: existing.severityOverriddenByAnalyst
          ? existing.severity
          : (input.severity ?? existing.severity),
        updatedAt: new Date(),
      })
      .where(eq(alerts.id, existing.id))
      .returning();
    return { alert: updated ?? existing, created: false };
  }

  const id = newId("alert");
  const [inserted] = await db
    .insert(alerts)
    .values({
      id,
      organisationId: input.organisationId,
      sourceId: input.sourceId,
      tenantId,
      externalId: input.externalId,
      severity: input.severity ?? "medium",
      ...providerFields,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { alert: inserted, created: true };

  // Lost a create race: read back the row the other writer inserted.
  const [raced] = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.organisationId, input.organisationId),
        eq(alerts.sourceId, input.sourceId),
        eq(alerts.tenantId, tenantId),
        eq(alerts.externalId, input.externalId),
      ),
    )
    .limit(1);
  if (!raced) throw new AlertError("Alert could not be created", 500);
  return { alert: raced, created: false };
}

async function caseIdsForAlert(alertId: string, organisationId: string): Promise<string[]> {
  const rows = await db
    .select({ caseId: caseAlerts.caseId })
    .from(caseAlerts)
    .where(and(eq(caseAlerts.alertId, alertId), eq(caseAlerts.organisationId, organisationId)));
  return rows.map((r) => r.caseId);
}

/** Attaches an alert to a case. Idempotent: linking an already-linked alert is a no-op, not an error. */
export async function linkAlertToCaseCore(opts: {
  organisationId: string;
  actorId: string | null;
  caseId: string;
  alertId: string;
  isPrimary?: boolean;
}): Promise<CaseAlert> {
  const [caseRow, alertRow] = await Promise.all([
    loadCaseInOrg(opts.caseId, opts.organisationId),
    getAlertInOrg(opts.alertId, opts.organisationId),
  ]);
  if (!caseRow) throw new AlertError("Case not found", 404);
  if (!alertRow) throw new AlertError("Alert not found", 404);

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

  if (inserted) {
    await writeTimelineEvent({
      caseId: opts.caseId,
      actorId: opts.actorId,
      eventType: "alert_linked_to_case",
      payload: {
        alert_id: opts.alertId,
        title: alertRow.title,
        severity: alertRow.severity,
        is_primary: opts.isPrimary ?? false,
      },
    });
    return inserted;
  }
  const [existing] = await db
    .select()
    .from(caseAlerts)
    .where(and(eq(caseAlerts.caseId, opts.caseId), eq(caseAlerts.alertId, opts.alertId)))
    .limit(1);
  if (!existing) throw new AlertError("Alert could not be linked to case", 500);
  return existing;
}

export type AlertDispositionPatch = Partial<{
  status: Alert["status"];
  determination: Alert["determination"];
  severity: Alert["severity"];
  assigneeId: string | null;
  analystNotes: string | null;
  dismissedReason: string | null;
}>;

export class AlertVersionConflictError extends AlertError {
  current: Alert;
  constructor(current: Alert) {
    super("alert_version_conflict", 409);
    this.current = current;
  }
}

/**
 * Analyst-owned disposition update. Never writes a provider-owned column.
 * `expectedVersion`, when supplied, guards against a lost update the same
 * way `patchCaseCore` guards case fields.
 */
export async function setAlertDispositionCore(opts: {
  organisationId: string;
  actorId: string | null;
  alertId: string;
  patch: AlertDispositionPatch;
  expectedVersion?: number;
}): Promise<Alert> {
  const existing = await getAlertInOrg(opts.alertId, opts.organisationId);
  if (!existing) throw new AlertError("Alert not found", 404);
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== existing.version) {
    throw new AlertVersionConflictError(existing);
  }

  const set: Partial<typeof alerts.$inferInsert> = {};
  const caseIds = await caseIdsForAlert(opts.alertId, opts.organisationId);
  const events: Array<{ eventType: "alert_status_changed" | "alert_verdict_changed" | "alert_assigned"; payload: Record<string, unknown> }> = [];

  if (opts.patch.status !== undefined && opts.patch.status !== existing.status) {
    set.status = opts.patch.status;
    events.push({ eventType: "alert_status_changed", payload: { from: existing.status, to: opts.patch.status } });
  }
  if (
    opts.patch.determination !== undefined &&
    opts.patch.determination !== existing.determination
  ) {
    set.determination = opts.patch.determination;
    events.push({
      eventType: "alert_verdict_changed",
      payload: { field: "determination", from: existing.determination, to: opts.patch.determination },
    });
  }
  if (opts.patch.severity !== undefined && opts.patch.severity !== existing.severity) {
    set.severity = opts.patch.severity;
    set.severityOverriddenByAnalyst = true;
    events.push({
      eventType: "alert_verdict_changed",
      payload: { field: "severity", from: existing.severity, to: opts.patch.severity },
    });
  }
  if (opts.patch.assigneeId !== undefined && opts.patch.assigneeId !== existing.assigneeId) {
    set.assigneeId = opts.patch.assigneeId;
    events.push({ eventType: "alert_assigned", payload: { from: existing.assigneeId, to: opts.patch.assigneeId } });
  }
  if (opts.patch.analystNotes !== undefined) set.analystNotes = opts.patch.analystNotes;
  if (opts.patch.dismissedReason !== undefined) set.dismissedReason = opts.patch.dismissedReason;

  if (Object.keys(set).length === 0) return existing;
  set.updatedAt = new Date();
  set.version = existing.version + 1;

  const conditions = [eq(alerts.id, opts.alertId)];
  if (opts.expectedVersion !== undefined) conditions.push(eq(alerts.version, opts.expectedVersion));
  const [updated] = await db
    .update(alerts)
    .set(set)
    .where(and(...conditions))
    .returning();
  if (!updated) {
    const current = await getAlertInOrg(opts.alertId, opts.organisationId);
    if (!current) throw new AlertError("Alert not found", 404);
    throw new AlertVersionConflictError(current);
  }

  for (const caseId of caseIds) {
    for (const event of events) {
      await writeTimelineEvent({
        caseId,
        actorId: opts.actorId,
        eventType: event.eventType,
        payload: { alert_id: opts.alertId, ...event.payload },
      });
    }
  }
  return updated;
}

/** Links an entity to an alert with a role. Idempotent per (alert, entity, role). */
export async function linkEntityToAlertCore(opts: {
  organisationId: string;
  actorId: string | null;
  alertId: string;
  entityId: string;
  role: AlertEntity["role"];
}): Promise<AlertEntity> {
  const [alertRow, entityRow] = await Promise.all([
    getAlertInOrg(opts.alertId, opts.organisationId),
    db
      .select({ id: entities.id, displayName: entities.displayName })
      .from(entities)
      .where(and(eq(entities.id, opts.entityId), eq(entities.organisationId, opts.organisationId)))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);
  if (!alertRow) throw new AlertError("Alert not found", 404);
  if (!entityRow) throw new AlertError("Entity not found", 404);

  const [inserted] = await db
    .insert(alertEntities)
    .values({
      id: newId("aent"),
      organisationId: opts.organisationId,
      alertId: opts.alertId,
      entityId: opts.entityId,
      role: opts.role,
      addedBy: opts.actorId,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    const caseIds = await caseIdsForAlert(opts.alertId, opts.organisationId);
    for (const caseId of caseIds) {
      await writeTimelineEvent({
        caseId,
        actorId: opts.actorId,
        eventType: "alert_entity_linked",
        payload: {
          alert_id: opts.alertId,
          entity_id: opts.entityId,
          entity_name: entityRow.displayName,
          role: opts.role,
        },
      });
    }
    return inserted;
  }
  const [existing] = await db
    .select()
    .from(alertEntities)
    .where(
      and(
        eq(alertEntities.alertId, opts.alertId),
        eq(alertEntities.entityId, opts.entityId),
        eq(alertEntities.role, opts.role),
      ),
    )
    .limit(1);
  if (!existing) throw new AlertError("Entity could not be linked to alert", 500);
  return existing;
}

export async function listEntitiesForAlert(
  alertId: string,
  organisationId: string,
): Promise<Entity[]> {
  const links = await db
    .select({ entityId: alertEntities.entityId, role: alertEntities.role })
    .from(alertEntities)
    .where(and(eq(alertEntities.alertId, alertId), eq(alertEntities.organisationId, organisationId)));
  if (links.length === 0) return [];
  return db
    .select()
    .from(entities)
    .where(
      and(
        eq(entities.organisationId, organisationId),
        inArray(entities.id, links.map((l) => l.entityId)),
      ),
    );
}

/** Keyset-paginated alerts attached to a case, most recently created first. */
export async function listAlertsForCaseCore(
  organisationId: string,
  caseId: string,
  opts: { limit?: number | null; cursor?: string | null } = {},
): Promise<ListPage<Alert & { isPrimary: boolean }>> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new AlertError("Case not found", 404);

  const limit = clampLimit(opts.limit);
  const cursor: KeysetCursor | null = decodeCursor(opts.cursor);
  const conditions = [
    eq(caseAlerts.caseId, caseId),
    eq(caseAlerts.organisationId, organisationId),
  ];
  if (cursor) {
    conditions.push(
      or(
        lt(alerts.createdAt, cursor.at),
        and(eq(alerts.createdAt, cursor.at), lt(alerts.id, cursor.id))!,
      )!,
    );
  }

  const rows = await db
    .select({ alert: alerts, isPrimary: caseAlerts.isPrimary })
    .from(caseAlerts)
    .innerJoin(alerts, eq(alerts.id, caseAlerts.alertId))
    .where(and(...conditions))
    .orderBy(desc(alerts.createdAt), desc(alerts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ ...r.alert, isPrimary: r.isPrimary })),
    nextCursor: hasMore && last ? encodeCursor({ at: last.alert.createdAt, id: last.alert.id }) : null,
  };
}

/** Entities aggregated across every alert currently attached to a case. */
export async function listEntitiesForCaseCore(
  organisationId: string,
  caseId: string,
  opts: { limit?: number | null; cursor?: string | null } = {},
): Promise<ListPage<Entity>> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new AlertError("Case not found", 404);

  const alertIdRows = await db
    .select({ alertId: caseAlerts.alertId })
    .from(caseAlerts)
    .where(and(eq(caseAlerts.caseId, caseId), eq(caseAlerts.organisationId, organisationId)));
  const alertIds = alertIdRows.map((r) => r.alertId);
  if (alertIds.length === 0) return { items: [], nextCursor: null };

  const linkRows = await db
    .select({ entityId: alertEntities.entityId })
    .from(alertEntities)
    .where(and(inArray(alertEntities.alertId, alertIds), eq(alertEntities.organisationId, organisationId)));
  const entityIds = [...new Set(linkRows.map((r) => r.entityId))];
  if (entityIds.length === 0) return { items: [], nextCursor: null };

  const all = await db
    .select()
    .from(entities)
    .where(and(eq(entities.organisationId, organisationId), inArray(entities.id, entityIds)))
    .orderBy(desc(entities.lastSeenAt), desc(entities.id));

  const limit = clampLimit(opts.limit);
  const cursor = decodeCursor(opts.cursor);
  const startIndex = cursor
    ? all.findIndex(
        (e) => e.lastSeenAt.getTime() < cursor.at.getTime() ||
          (e.lastSeenAt.getTime() === cursor.at.getTime() && e.id < cursor.id),
      )
    : 0;
  const from = startIndex < 0 ? all.length : startIndex;
  const page = all.slice(from, from + limit);
  const hasMore = from + limit < all.length;
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: hasMore && last ? encodeCursor({ at: last.lastSeenAt, id: last.id }) : null,
  };
}
