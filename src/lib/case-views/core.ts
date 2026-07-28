/**
 * Saved case views: CRUD, ownership, defaults, complete counts, widgets.
 *
 * Permission model:
 * - personal: owner manages; only owner (and list for self) sees them
 * - team: team members manage; team members + admins see them
 * - organisation: admins manage; every org member sees them
 * - role/team defaults: admins only; personal defaults: the user
 *
 * Counts and widgets always run complete organisation-scoped aggregate
 * queries — never derived from the current page of rows.
 */
import { and, asc, count, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  caseViewDefaults,
  caseViews,
  cases,
  teamMembers,
  teams,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { recordAuditEvent } from "@/lib/audit/events";
import { caseSlaAtRiskSql, caseSlaBreachedSql, caseSlaWarningSql } from "@/lib/sla";
import {
  CASE_VIEW_VISIBILITIES,
  compactCaseViewConfig,
  parseCaseViewConfig,
  type CaseViewConfig,
  type CaseViewDefaultScope,
  type CaseViewVisibility,
  type CaseViewWidget,
} from "./config";
import { buildCaseFilterClauses, type CaseFilterContext } from "./filters";

export type ActorRole = "admin" | "analyst" | "read_only";

export type CaseViewActor = {
  id: string;
  organisationId: string;
  role: ActorRole;
};

export type CaseViewRow = {
  id: string;
  organisationId: string;
  name: string;
  description: string | null;
  visibility: CaseViewVisibility;
  ownerUserId: string | null;
  teamId: string | null;
  config: CaseViewConfig;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export class CaseViewError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "CaseViewError";
  }
}

function toRow(row: typeof caseViews.$inferSelect): CaseViewRow {
  return {
    id: row.id,
    organisationId: row.organisationId,
    name: row.name,
    description: row.description,
    visibility: row.visibility as CaseViewVisibility,
    ownerUserId: row.ownerUserId,
    teamId: row.teamId,
    config: parseCaseViewConfig(row.config),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function teamIdsForUser(
  organisationId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.organisationId, organisationId),
        eq(teamMembers.userId, userId),
      ),
    );
  return rows.map((r) => r.teamId);
}

async function assertTeamInOrg(
  organisationId: string,
  teamId: string,
): Promise<void> {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)))
    .limit(1);
  if (!team) throw new CaseViewError("Team not found", 404);
}

function canReadView(
  actor: CaseViewActor,
  view: Pick<CaseViewRow, "visibility" | "ownerUserId" | "teamId" | "organisationId">,
  memberTeamIds: Set<string>,
): boolean {
  if (view.organisationId !== actor.organisationId) return false;
  if (view.visibility === "organisation") return true;
  if (view.visibility === "personal") {
    return view.ownerUserId === actor.id || actor.role === "admin";
  }
  // team
  if (!view.teamId) return false;
  return actor.role === "admin" || memberTeamIds.has(view.teamId);
}

function canWriteView(
  actor: CaseViewActor,
  view: Pick<CaseViewRow, "visibility" | "ownerUserId" | "teamId" | "organisationId">,
  memberTeamIds: Set<string>,
): boolean {
  if (view.organisationId !== actor.organisationId) return false;
  if (actor.role === "read_only") return false;
  if (view.visibility === "organisation") return actor.role === "admin";
  if (view.visibility === "personal") return view.ownerUserId === actor.id;
  // team: admin or team member ("authorised team owner" ≈ member with write role)
  if (!view.teamId) return false;
  return actor.role === "admin" || memberTeamIds.has(view.teamId);
}

function canCreateVisibility(
  actor: CaseViewActor,
  visibility: CaseViewVisibility,
  teamId: string | null | undefined,
  memberTeamIds: Set<string>,
): boolean {
  if (actor.role === "read_only") return false;
  if (visibility === "organisation") return actor.role === "admin";
  if (visibility === "personal") return actor.role === "admin" || actor.role === "analyst";
  if (!teamId) return false;
  return actor.role === "admin" || memberTeamIds.has(teamId);
}

export async function listCaseViewsCore(
  actor: CaseViewActor,
): Promise<CaseViewRow[]> {
  const memberTeamIds = new Set(
    await teamIdsForUser(actor.organisationId, actor.id),
  );
  const rows = await db
    .select()
    .from(caseViews)
    .where(eq(caseViews.organisationId, actor.organisationId))
    .orderBy(asc(caseViews.name));

  return rows
    .map(toRow)
    .filter((view) => canReadView(actor, view, memberTeamIds));
}

export async function getCaseViewCore(
  actor: CaseViewActor,
  viewId: string,
): Promise<CaseViewRow | null> {
  const memberTeamIds = new Set(
    await teamIdsForUser(actor.organisationId, actor.id),
  );
  const [row] = await db
    .select()
    .from(caseViews)
    .where(
      and(
        eq(caseViews.id, viewId),
        eq(caseViews.organisationId, actor.organisationId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const view = toRow(row);
  if (!canReadView(actor, view, memberTeamIds)) return null;
  return view;
}

export async function createCaseViewCore(
  actor: CaseViewActor,
  input: {
    name: string;
    description?: string | null;
    visibility: CaseViewVisibility;
    teamId?: string | null;
    config?: unknown;
  },
): Promise<CaseViewRow> {
  if (!(CASE_VIEW_VISIBILITIES as readonly string[]).includes(input.visibility)) {
    throw new CaseViewError("Invalid visibility");
  }
  const memberTeamIds = new Set(
    await teamIdsForUser(actor.organisationId, actor.id),
  );
  const teamId =
    input.visibility === "team" ? (input.teamId ?? null) : null;
  if (input.visibility === "team") {
    if (!teamId) throw new CaseViewError("teamId is required for team views");
    await assertTeamInOrg(actor.organisationId, teamId);
  }
  if (!canCreateVisibility(actor, input.visibility, teamId, memberTeamIds)) {
    throw new CaseViewError("Not allowed to create this view", 403);
  }

  let config: CaseViewConfig;
  try {
    config = compactCaseViewConfig(parseCaseViewConfig(input.config ?? {}));
  } catch (error) {
    throw new CaseViewError(
      error instanceof Error ? error.message : "Invalid view config",
      400,
    );
  }

  const id = newId("cview");
  const name = input.name.trim();
  if (!name) throw new CaseViewError("Name is required");

  const [inserted] = await db
    .insert(caseViews)
    .values({
      id,
      organisationId: actor.organisationId,
      name,
      description: input.description?.trim() || null,
      visibility: input.visibility,
      ownerUserId: input.visibility === "personal" ? actor.id : null,
      teamId,
      config,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();

  if (input.visibility !== "personal") {
    await recordAuditEvent({
      organisationId: actor.organisationId,
      actorId: actor.id,
      actorType: "user",
      action: "case_view.created",
      targetType: "case_view",
      targetId: id,
      targetLabel: name,
      after: {
        visibility: input.visibility,
        teamId,
        name,
      },
    });
  }

  return toRow(inserted);
}

export async function updateCaseViewCore(
  actor: CaseViewActor,
  viewId: string,
  input: {
    name?: string;
    description?: string | null;
    config?: unknown;
  },
): Promise<CaseViewRow> {
  const memberTeamIds = new Set(
    await teamIdsForUser(actor.organisationId, actor.id),
  );
  const [existing] = await db
    .select()
    .from(caseViews)
    .where(
      and(
        eq(caseViews.id, viewId),
        eq(caseViews.organisationId, actor.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new CaseViewError("View not found", 404);
  const view = toRow(existing);
  if (!canWriteView(actor, view, memberTeamIds)) {
    throw new CaseViewError("Not allowed to update this view", 403);
  }

  const patch: Partial<typeof caseViews.$inferInsert> = {
    updatedBy: actor.id,
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new CaseViewError("Name is required");
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.config !== undefined) {
    try {
      patch.config = compactCaseViewConfig(parseCaseViewConfig(input.config));
    } catch (error) {
      throw new CaseViewError(
        error instanceof Error ? error.message : "Invalid view config",
        400,
      );
    }
  }

  const [updated] = await db
    .update(caseViews)
    .set(patch)
    .where(
      and(
        eq(caseViews.id, viewId),
        eq(caseViews.organisationId, actor.organisationId),
      ),
    )
    .returning();

  if (view.visibility !== "personal") {
    await recordAuditEvent({
      organisationId: actor.organisationId,
      actorId: actor.id,
      actorType: "user",
      action: "case_view.updated",
      targetType: "case_view",
      targetId: viewId,
      targetLabel: updated.name,
      before: {
        name: existing.name,
        description: existing.description,
      },
      after: {
        name: updated.name,
        description: updated.description,
      },
    });
  }

  return toRow(updated);
}

export async function deleteCaseViewCore(
  actor: CaseViewActor,
  viewId: string,
): Promise<void> {
  const memberTeamIds = new Set(
    await teamIdsForUser(actor.organisationId, actor.id),
  );
  const [existing] = await db
    .select()
    .from(caseViews)
    .where(
      and(
        eq(caseViews.id, viewId),
        eq(caseViews.organisationId, actor.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new CaseViewError("View not found", 404);
  const view = toRow(existing);
  if (!canWriteView(actor, view, memberTeamIds)) {
    throw new CaseViewError("Not allowed to delete this view", 403);
  }

  await db
    .delete(caseViews)
    .where(
      and(
        eq(caseViews.id, viewId),
        eq(caseViews.organisationId, actor.organisationId),
      ),
    );

  if (view.visibility !== "personal") {
    await recordAuditEvent({
      organisationId: actor.organisationId,
      actorId: actor.id,
      actorType: "user",
      action: "case_view.deleted",
      targetType: "case_view",
      targetId: viewId,
      targetLabel: existing.name,
      before: {
        visibility: existing.visibility,
        teamId: existing.teamId,
        name: existing.name,
      },
    });
  }
}

export async function duplicateCaseViewCore(
  actor: CaseViewActor,
  viewId: string,
  opts: { name?: string; visibility?: CaseViewVisibility; teamId?: string | null } = {},
): Promise<CaseViewRow> {
  const source = await getCaseViewCore(actor, viewId);
  if (!source) throw new CaseViewError("View not found", 404);

  return createCaseViewCore(actor, {
    name: opts.name?.trim() || `${source.name} (copy)`,
    description: source.description,
    visibility: opts.visibility ?? "personal",
    teamId: opts.visibility === "team" ? (opts.teamId ?? source.teamId) : null,
    config: source.config,
  });
}

export async function renameCaseViewCore(
  actor: CaseViewActor,
  viewId: string,
  name: string,
): Promise<CaseViewRow> {
  return updateCaseViewCore(actor, viewId, { name });
}

/* ── Defaults ──────────────────────────────────────────────────────────── */

export type CaseViewDefaultRow = {
  id: string;
  scope: CaseViewDefaultScope;
  userId: string | null;
  role: ActorRole | null;
  teamId: string | null;
  viewId: string;
};

export async function listCaseViewDefaultsCore(
  actor: CaseViewActor,
): Promise<CaseViewDefaultRow[]> {
  const rows = await db
    .select()
    .from(caseViewDefaults)
    .where(eq(caseViewDefaults.organisationId, actor.organisationId));

  // Analysts see their personal default + role/team defaults; not other users' personal.
  return rows
    .filter((row) => {
      if (row.scope === "personal") {
        return row.userId === actor.id || actor.role === "admin";
      }
      return true;
    })
    .map((row) => ({
      id: row.id,
      scope: row.scope as CaseViewDefaultScope,
      userId: row.userId,
      role: (row.role as ActorRole | null) ?? null,
      teamId: row.teamId,
      viewId: row.viewId,
    }));
}

export async function setCaseViewDefaultCore(
  actor: CaseViewActor,
  input: {
    scope: CaseViewDefaultScope;
    viewId: string | null;
    role?: ActorRole;
    teamId?: string;
  },
): Promise<void> {
  if (input.scope === "personal") {
    // Users set their own personal default.
    if (actor.role === "read_only" && input.viewId) {
      // read_only may still pick a default view for reading
    }
  } else if (actor.role !== "admin") {
    throw new CaseViewError("Only admins manage role/team defaults", 403);
  }

  if (input.scope === "role" && !input.role) {
    throw new CaseViewError("role is required for role defaults");
  }
  if (input.scope === "team") {
    if (!input.teamId) throw new CaseViewError("teamId is required for team defaults");
    await assertTeamInOrg(actor.organisationId, input.teamId);
  }

  // Clear default
  if (input.viewId === null) {
    const conditions: SQL[] = [
      eq(caseViewDefaults.organisationId, actor.organisationId),
      eq(caseViewDefaults.scope, input.scope),
    ];
    if (input.scope === "personal") {
      conditions.push(eq(caseViewDefaults.userId, actor.id));
    } else if (input.scope === "role" && input.role) {
      conditions.push(eq(caseViewDefaults.role, input.role));
    } else if (input.scope === "team" && input.teamId) {
      conditions.push(eq(caseViewDefaults.teamId, input.teamId));
    }
    await db.delete(caseViewDefaults).where(and(...conditions));
    if (input.scope !== "personal") {
      await recordAuditEvent({
        organisationId: actor.organisationId,
        actorId: actor.id,
        actorType: "user",
        action: "case_view.default_cleared",
        targetType: "case_view_default",
        metadata: {
          scope: input.scope,
          role: input.role ?? null,
          teamId: input.teamId ?? null,
        },
      });
    }
    return;
  }

  // Ensure view is readable and in-org
  const view = await getCaseViewCore(actor, input.viewId);
  if (!view) throw new CaseViewError("View not found or not accessible", 404);

  // Upsert by deleting existing then inserting (partial unique indexes).
  const conditions: SQL[] = [
    eq(caseViewDefaults.organisationId, actor.organisationId),
    eq(caseViewDefaults.scope, input.scope),
  ];
  if (input.scope === "personal") {
    conditions.push(eq(caseViewDefaults.userId, actor.id));
  } else if (input.scope === "role" && input.role) {
    conditions.push(eq(caseViewDefaults.role, input.role));
  } else if (input.scope === "team" && input.teamId) {
    conditions.push(eq(caseViewDefaults.teamId, input.teamId));
  }
  await db.delete(caseViewDefaults).where(and(...conditions));

  await db.insert(caseViewDefaults).values({
    id: newId("cvdef"),
    organisationId: actor.organisationId,
    scope: input.scope,
    userId: input.scope === "personal" ? actor.id : null,
    role: input.scope === "role" ? (input.role ?? null) : null,
    teamId: input.scope === "team" ? (input.teamId ?? null) : null,
    viewId: input.viewId,
    setBy: actor.id,
  });

  if (input.scope !== "personal") {
    await recordAuditEvent({
      organisationId: actor.organisationId,
      actorId: actor.id,
      actorType: "user",
      action: "case_view.default_set",
      targetType: "case_view",
      targetId: input.viewId,
      targetLabel: view.name,
      after: {
        scope: input.scope,
        role: input.role ?? null,
        teamId: input.teamId ?? null,
        viewId: input.viewId,
      },
    });
  }
}

/**
 * Resolve which saved view (if any) should open by default.
 * Order: personal → team membership defaults → role default.
 */
export async function resolveDefaultCaseViewCore(
  actor: CaseViewActor,
): Promise<CaseViewRow | null> {
  const defaults = await listCaseViewDefaultsCore(actor);
  const personal = defaults.find(
    (d) => d.scope === "personal" && d.userId === actor.id,
  );
  if (personal) {
    const view = await getCaseViewCore(actor, personal.viewId);
    if (view) return view;
  }

  const memberTeamIds = await teamIdsForUser(actor.organisationId, actor.id);
  for (const teamId of memberTeamIds) {
    const teamDefault = defaults.find(
      (d) => d.scope === "team" && d.teamId === teamId,
    );
    if (teamDefault) {
      const view = await getCaseViewCore(actor, teamDefault.viewId);
      if (view) return view;
    }
  }

  const roleDefault = defaults.find(
    (d) => d.scope === "role" && d.role === actor.role,
  );
  if (roleDefault) {
    const view = await getCaseViewCore(actor, roleDefault.viewId);
    if (view) return view;
  }

  return null;
}

/* ── Counts & widgets ──────────────────────────────────────────────────── */

export type CaseViewCount = {
  total: number;
  active: number;
  critical: number;
  high: number;
};

export async function countCasesForConfigCore(
  ctx: CaseFilterContext,
  config: CaseViewConfig,
): Promise<CaseViewCount> {
  const where = and(...buildCaseFilterClauses(config, ctx));
  const [metrics] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${cases.status} <> 'closed')`,
      critical: sql<number>`count(*) filter (where ${cases.severity} = 'critical')`,
      high: sql<number>`count(*) filter (where ${cases.severity} = 'high')`,
    })
    .from(cases)
    .where(where);
  return {
    total: Number(metrics?.total ?? 0),
    active: Number(metrics?.active ?? 0),
    critical: Number(metrics?.critical ?? 0),
    high: Number(metrics?.high ?? 0),
  };
}

export async function countCaseViewCore(
  actor: CaseViewActor,
  viewId: string,
  watchedCaseIds: string[],
): Promise<CaseViewCount | null> {
  const view = await getCaseViewCore(actor, viewId);
  if (!view) return null;
  return countCasesForConfigCore(
    {
      organisationId: actor.organisationId,
      userId: actor.id,
      watchedCaseIds,
    },
    view.config,
  );
}

export async function countManyCaseViewsCore(
  actor: CaseViewActor,
  viewIds: string[],
  watchedCaseIds: string[],
): Promise<Record<string, CaseViewCount>> {
  const unique = Array.from(new Set(viewIds)).slice(0, 50);
  const out: Record<string, CaseViewCount> = {};
  await Promise.all(
    unique.map(async (id) => {
      const countResult = await countCaseViewCore(actor, id, watchedCaseIds);
      if (countResult) out[id] = countResult;
    }),
  );
  return out;
}

export type CaseViewWidgetResult =
  | {
      type: "severity_breakdown";
      counts: Record<string, number>;
    }
  | {
      type: "status_breakdown";
      counts: Record<string, number>;
    }
  | {
      type: "sla_summary";
      atRisk: number;
      warning: number;
      breached: number;
      clear: number;
      total: number;
    }
  | {
      type: "workload_summary";
      unassigned: number;
      assigned: number;
      total: number;
    };

export async function computeCaseViewWidgetsCore(
  ctx: CaseFilterContext,
  config: CaseViewConfig,
  widgets?: CaseViewWidget[],
): Promise<CaseViewWidgetResult[]> {
  const requested = widgets ?? config.widgets;
  if (requested.length === 0) return [];

  const baseWhere = and(...buildCaseFilterClauses(config, ctx));
  const results: CaseViewWidgetResult[] = [];

  for (const widget of requested) {
    switch (widget) {
      case "severity_breakdown": {
        const rows = await db
          .select({
            severity: cases.severity,
            n: count(),
          })
          .from(cases)
          .where(baseWhere)
          .groupBy(cases.severity);
        const counts: Record<string, number> = {
          low: 0,
          medium: 0,
          high: 0,
          critical: 0,
        };
        for (const row of rows) counts[row.severity] = Number(row.n);
        results.push({ type: "severity_breakdown", counts });
        break;
      }
      case "status_breakdown": {
        const rows = await db
          .select({
            status: cases.status,
            n: count(),
          })
          .from(cases)
          .where(baseWhere)
          .groupBy(cases.status);
        const counts: Record<string, number> = {};
        for (const row of rows) counts[row.status] = Number(row.n);
        results.push({ type: "status_breakdown", counts });
        break;
      }
      case "sla_summary": {
        const atRisk = caseSlaAtRiskSql();
        const warning = caseSlaWarningSql();
        const breached = caseSlaBreachedSql();
        const [row] = await db
          .select({
            total: count(),
            atRisk: sql<number>`count(*) filter (where ${atRisk})`,
            warning: sql<number>`count(*) filter (where ${warning})`,
            breached: sql<number>`count(*) filter (where ${breached})`,
          })
          .from(cases)
          .where(baseWhere);
        const total = Number(row?.total ?? 0);
        const atRiskN = Number(row?.atRisk ?? 0);
        results.push({
          type: "sla_summary",
          atRisk: atRiskN,
          warning: Number(row?.warning ?? 0),
          breached: Number(row?.breached ?? 0),
          clear: Math.max(0, total - atRiskN),
          total,
        });
        break;
      }
      case "workload_summary": {
        const [row] = await db
          .select({
            total: count(),
            unassigned: sql<number>`count(*) filter (where ${cases.assigneeId} is null)`,
            assigned: sql<number>`count(*) filter (where ${cases.assigneeId} is not null)`,
          })
          .from(cases)
          .where(baseWhere);
        results.push({
          type: "workload_summary",
          unassigned: Number(row?.unassigned ?? 0),
          assigned: Number(row?.assigned ?? 0),
          total: Number(row?.total ?? 0),
        });
        break;
      }
    }
  }

  return results;
}

/** Public for API tokens that act without a session user id. */
export function actorFromToken(input: {
  organisationId: string;
  createdBy: string | null;
  /** Token scopes do not carry a role; treat as analyst-equivalent for views. */
  asAdmin?: boolean;
}): CaseViewActor {
  return {
    id: input.createdBy ?? "api_token",
    organisationId: input.organisationId,
    role: input.asAdmin ? "admin" : "analyst",
  };
}

export async function listAccessibleViewIds(
  actor: CaseViewActor,
): Promise<string[]> {
  const views = await listCaseViewsCore(actor);
  return views.map((v) => v.id);
}


