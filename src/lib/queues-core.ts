/**
 * Organisation teams, specialised queues, and queue/analyst assignment.
 *
 * Queue ownership (`cases.queueId`) is deliberately separate from individual
 * ownership (`cases.assigneeId`): a case can sit in a team queue with no
 * analyst assigned yet, and assigning an analyst does not require or imply a
 * queue. All aggregate queries here (workload, queue health) run as
 * database-side `count`/`sum` aggregates so they stay correct for the whole
 * queue, not just whatever page a UI happens to be rendering.
 */
import { db } from "@/db";
import {
  cases,
  caseAssignees,
  queues,
  teamMembers,
  teams,
  users,
} from "@/db/schema";
import type { CaseSeverity } from "./cases-core";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";
import { caseSlaAtRiskSql } from "./sla";

/** Weighted so a handful of criticals outweigh a pile of low-severity cases. */
export const SEVERITY_WEIGHT: Record<CaseSeverity, number> = {
  low: 1,
  medium: 2,
  high: 4,
  critical: 8,
};

const SEVERITY_WEIGHT_SQL = sql<number>`case ${cases.severity}
  when 'critical' then 8 when 'high' then 4 when 'medium' then 2 else 1 end`;

export async function createTeamCore(
  organisationId: string,
  actorId: string | null,
  name: string,
  description?: string | null,
): Promise<{ id: string }> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Team name is required");
  const [inserted] = await db
    .insert(teams)
    .values({
      id: newId("team"),
      organisationId,
      name: trimmed,
      description: description?.trim() || null,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning({ id: teams.id });
  if (!inserted) throw new Error("A team with this name already exists");
  return inserted;
}

export async function setTeamActiveCore(
  organisationId: string,
  teamId: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(teams)
    .set({ isActive })
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)));
}

export async function addTeamMemberCore(
  organisationId: string,
  actorId: string | null,
  teamId: string,
  userId: string,
): Promise<void> {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)))
    .limit(1);
  if (!team) throw new Error("Team not found");
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  if (!member) throw new Error("User is not a member of this organisation");
  await db
    .insert(teamMembers)
    .values({
      id: newId("tmem"),
      organisationId,
      teamId,
      userId,
      addedBy: actorId,
    })
    .onConflictDoNothing();
}

export async function removeTeamMemberCore(
  organisationId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(teamMembers)
    .where(
      and(
        eq(teamMembers.organisationId, organisationId),
        eq(teamMembers.teamId, teamId),
        eq(teamMembers.userId, userId),
      ),
    );
}

export async function createQueueCore(
  organisationId: string,
  actorId: string | null,
  teamId: string,
  name: string,
  description?: string | null,
): Promise<{ id: string }> {
  const [team] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)))
    .limit(1);
  if (!team) throw new Error("Team not found");
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Queue name is required");
  const [inserted] = await db
    .insert(queues)
    .values({
      id: newId("queue"),
      organisationId,
      teamId,
      name: trimmed,
      description: description?.trim() || null,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning({ id: queues.id });
  if (!inserted) throw new Error("A queue with this name already exists on this team");
  return inserted;
}

export async function setQueueActiveCore(
  organisationId: string,
  queueId: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(queues)
    .set({ isActive })
    .where(and(eq(queues.id, queueId), eq(queues.organisationId, organisationId)));
}

export async function listTeamsCore(organisationId: string) {
  return db
    .select()
    .from(teams)
    .where(eq(teams.organisationId, organisationId))
    .orderBy(asc(teams.name));
}

export async function listQueuesCore(organisationId: string) {
  return db
    .select({
      id: queues.id,
      name: queues.name,
      description: queues.description,
      isActive: queues.isActive,
      teamId: queues.teamId,
      teamName: teams.name,
      createdAt: queues.createdAt,
    })
    .from(queues)
    .innerJoin(teams, eq(teams.id, queues.teamId))
    .where(eq(queues.organisationId, organisationId))
    .orderBy(asc(teams.name), asc(queues.name));
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function assignCaseQueueCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  queueId: string | null,
): Promise<void> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");
  if (queueId) {
    const [queue] = await db
      .select({ id: queues.id })
      .from(queues)
      .where(and(eq(queues.id, queueId), eq(queues.organisationId, organisationId)))
      .limit(1);
    if (!queue) throw new Error("Queue not found");
  }
  if (existing.queueId === queueId) return;
  await db
    .update(cases)
    .set({
      queueId,
      queueAssignedAt: new Date(),
      queueAssignedBy: actorId,
    })
    .where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "queue_assignment_change",
    payload: { from: existing.queueId, to: queueId },
  });
}

export async function assignCaseAnalystCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  assigneeId: string | null,
): Promise<void> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");
  if (existing.assigneeId === assigneeId) return;
  await db
    .update(cases)
    .set({
      assigneeId,
      assigneeAssignedAt: assigneeId ? new Date() : null,
      assigneeAssignedBy: assigneeId ? actorId : null,
      version: sql`${cases.version} + 1`,
    })
    .where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "assignment_change",
    payload: { from: existing.assigneeId, to: assigneeId },
  });
}

export async function addAdditionalAssigneeCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  userId: string,
): Promise<void> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");
  if (existing.assigneeId === userId) {
    throw new Error("This analyst is already the primary owner");
  }
  const [member] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  if (!member) throw new Error("User is not a member of this organisation");
  await db
    .insert(caseAssignees)
    .values({
      id: newId("cassign"),
      organisationId,
      caseId,
      userId,
      addedBy: actorId,
    })
    .onConflictDoNothing();
}

export async function removeAdditionalAssigneeCore(
  organisationId: string,
  caseId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(caseAssignees)
    .where(
      and(
        eq(caseAssignees.organisationId, organisationId),
        eq(caseAssignees.caseId, caseId),
        eq(caseAssignees.userId, userId),
      ),
    );
}

export async function listAdditionalAssigneesCore(
  organisationId: string,
  caseId: string,
) {
  return db
    .select({
      userId: caseAssignees.userId,
      userName: users.name,
      createdAt: caseAssignees.createdAt,
    })
    .from(caseAssignees)
    .innerJoin(users, eq(users.id, caseAssignees.userId))
    .where(
      and(
        eq(caseAssignees.organisationId, organisationId),
        eq(caseAssignees.caseId, caseId),
      ),
    );
}

/**
 * Explicit acknowledge action, distinct from the automatic acknowledgedAt
 * stamp `setCaseStatusCore` still applies on the first open -> in_progress
 * transition, and distinct from queue/analyst assignment timestamps.
 * Whichever happens first (explicit action or status transition) wins; this
 * never overwrites an existing acknowledgement.
 */
export async function acknowledgeCaseCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
): Promise<{ alreadyAcknowledged: boolean }> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");
  if (existing.acknowledgedAt) return { alreadyAcknowledged: true };
  await db
    .update(cases)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: actorId })
    .where(and(eq(cases.id, caseId), sql`${cases.acknowledgedAt} is null`));
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "acknowledged",
    payload: {},
  });
  return { alreadyAcknowledged: false };
}

export async function setWaitingReasonCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  reason: "none" | "third_party" | "approval",
): Promise<void> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new Error("Case not found");
  if (existing.waitingReason === reason) return;
  await db
    .update(cases)
    .set({
      waitingReason: reason,
      waitingSince: reason === "none" ? null : new Date(),
    })
    .where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "custom",
    payload: { field: "waiting_reason", from: existing.waitingReason, to: reason },
  });
}

export type WorkloadRow = {
  userId: string;
  userName: string;
  activeCases: number;
  weightedScore: number;
};

/**
 * Per-analyst active workload (primary owner + additional assignee),
 * severity-weighted, closed cases excluded. Runs as two grouped aggregate
 * queries so it stays accurate for the whole organisation, not a capped page.
 */
export async function analystWorkloadCore(
  organisationId: string,
): Promise<WorkloadRow[]> {
  const [primary, additional, orgUsers] = await Promise.all([
    db
      .select({
        userId: cases.assigneeId,
        activeCases: count(),
        weightedScore: sql<number>`coalesce(sum(${SEVERITY_WEIGHT_SQL}), 0)`,
      })
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, organisationId),
          sql`${cases.status} <> 'closed'`,
          sql`${cases.assigneeId} is not null`,
        ),
      )
      .groupBy(cases.assigneeId),
    db
      .select({
        userId: caseAssignees.userId,
        activeCases: count(),
        weightedScore: sql<number>`coalesce(sum(${SEVERITY_WEIGHT_SQL}), 0)`,
      })
      .from(caseAssignees)
      .innerJoin(cases, eq(cases.id, caseAssignees.caseId))
      .where(
        and(
          eq(caseAssignees.organisationId, organisationId),
          sql`${cases.status} <> 'closed'`,
        ),
      )
      .groupBy(caseAssignees.userId),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, organisationId)),
  ]);

  const totals = new Map<string, { activeCases: number; weightedScore: number }>();
  for (const row of [...primary, ...additional]) {
    if (!row.userId) continue;
    const current = totals.get(row.userId) ?? { activeCases: 0, weightedScore: 0 };
    current.activeCases += Number(row.activeCases);
    current.weightedScore += Number(row.weightedScore);
    totals.set(row.userId, current);
  }
  const nameById = new Map(orgUsers.map((u) => [u.id, u.name]));
  return [...totals.entries()]
    .map(([userId, value]) => ({
      userId,
      userName: nameById.get(userId) ?? "Former member",
      activeCases: value.activeCases,
      weightedScore: value.weightedScore,
    }))
    .sort((a, b) => b.weightedScore - a.weightedScore);
}

export type AgingBuckets = {
  under4h: number;
  from4hTo24h: number;
  from1dTo3d: number;
  over3d: number;
};

export type QueueHealth = {
  queueId: string;
  queueName: string;
  teamName: string;
  openCount: number;
  unassignedCount: number;
  slaAtRiskCount: number;
  aging: AgingBuckets;
};

/**
 * Per-team-queue health: open count, unassigned count, SLA-at-risk count,
 * and aging buckets by time since last activity. One aggregate query per
 * metric across the whole queue -- never a capped page of rows.
 */
export async function queueHealthCore(organisationId: string): Promise<QueueHealth[]> {
  const orgQueues = await listQueuesCore(organisationId);
  if (orgQueues.length === 0) return [];
  const slaAtRisk = caseSlaAtRiskSql();
  const rows = await db
    .select({
      queueId: cases.queueId,
      openCount: count(),
      unassignedCount: sql<number>`count(*) filter (where ${cases.assigneeId} is null)`,
      slaAtRiskCount: sql<number>`count(*) filter (where ${slaAtRisk})`,
      under4h: sql<number>`count(*) filter (where now() - ${cases.lastActivityAt} < interval '4 hours')`,
      from4hTo24h: sql<number>`count(*) filter (where now() - ${cases.lastActivityAt} >= interval '4 hours' and now() - ${cases.lastActivityAt} < interval '24 hours')`,
      from1dTo3d: sql<number>`count(*) filter (where now() - ${cases.lastActivityAt} >= interval '24 hours' and now() - ${cases.lastActivityAt} < interval '3 days')`,
      over3d: sql<number>`count(*) filter (where now() - ${cases.lastActivityAt} >= interval '3 days')`,
    })
    .from(cases)
    .where(
      and(
        eq(cases.organisationId, organisationId),
        sql`${cases.status} <> 'closed'`,
        inArray(
          cases.queueId,
          orgQueues.map((q) => q.id),
        ),
      ),
    )
    .groupBy(cases.queueId);

  const byQueue = new Map(rows.map((r) => [r.queueId, r]));
  return orgQueues.map((queue) => {
    const row = byQueue.get(queue.id);
    return {
      queueId: queue.id,
      queueName: queue.name,
      teamName: queue.teamName,
      openCount: Number(row?.openCount ?? 0),
      unassignedCount: Number(row?.unassignedCount ?? 0),
      slaAtRiskCount: Number(row?.slaAtRiskCount ?? 0),
      aging: {
        under4h: Number(row?.under4h ?? 0),
        from4hTo24h: Number(row?.from4hTo24h ?? 0),
        from1dTo3d: Number(row?.from1dTo3d ?? 0),
        over3d: Number(row?.over3d ?? 0),
      },
    };
  });
}
