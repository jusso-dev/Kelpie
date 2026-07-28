/**
 * Read-only workload and queue-health aggregates.
 *
 * Every count/sum here is produced by a single grouped SQL aggregate query
 * against the full `cases` table (optionally left-joined from `teams`), never
 * by loading a page of rows and taking `array.length`. This matches the
 * acceptance criteria for issue #54: queue counts must reflect the complete
 * table, not a capped current-page result set.
 */

import { db } from "@/db";
import { cases, teams, users, slaPolicies, caseWatchers } from "@/db/schema";
import { and, count, desc, eq, isNotNull, sql } from "drizzle-orm";

/** critical=4, high=3, medium=2, low=1 — matches severityEnum's declared order. */
function severityWeightExpr() {
  return sql<number>`case ${cases.severity}
    when 'critical' then 4
    when 'high' then 3
    when 'medium' then 2
    else 1 end`;
}

export type AnalystWorkload = {
  userId: string;
  name: string;
  email: string;
  openCount: number;
  weightedScore: number;
  bySeverity: { critical: number; high: number; medium: number; low: number };
  unacknowledgedCount: number;
};

/**
 * One row per user in the org who is the PRIMARY assignee (`cases.assigneeId`)
 * on at least one non-closed case. Users with zero open cases are omitted —
 * an empty workload isn't "workload". Ordered by weightedScore descending.
 */
export async function getAnalystWorkloadCore(
  organisationId: string,
): Promise<AnalystWorkload[]> {
  const weightedScore = sql<number>`coalesce(sum(${severityWeightExpr()}), 0)`;

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      openCount: count(),
      weightedScore,
      critical: sql<number>`count(*) filter (where ${cases.severity} = 'critical')`,
      high: sql<number>`count(*) filter (where ${cases.severity} = 'high')`,
      medium: sql<number>`count(*) filter (where ${cases.severity} = 'medium')`,
      low: sql<number>`count(*) filter (where ${cases.severity} = 'low')`,
      unacknowledgedCount: sql<number>`count(*) filter (where ${cases.acknowledgedAt} is null)`,
    })
    .from(cases)
    .innerJoin(users, eq(users.id, cases.assigneeId))
    .where(
      and(
        eq(cases.organisationId, organisationId),
        isNotNull(cases.assigneeId),
        sql`${cases.status} <> 'closed'`,
      ),
    )
    .groupBy(users.id, users.name, users.email)
    .orderBy(desc(weightedScore));

  return rows.map((row) => ({
    userId: row.userId,
    name: row.name,
    email: row.email,
    openCount: Number(row.openCount),
    weightedScore: Number(row.weightedScore),
    bySeverity: {
      critical: Number(row.critical),
      high: Number(row.high),
      medium: Number(row.medium),
      low: Number(row.low),
    },
    unacknowledgedCount: Number(row.unacknowledgedCount),
  }));
}

export type TeamQueueHealth = {
  teamId: string;
  teamName: string;
  openCount: number;
  unassignedCount: number;
  weightedScore: number;
  agingBuckets: { "0-24h": number; "1-3d": number; "3-7d": number; "7d+": number };
  slaAtRisk: number;
};

/**
 * One row per ACTIVE team in the org, including teams with zero cases
 * currently queued (a zero-count queue is still meaningful operational
 * signal for a team, unlike an empty analyst workload).
 */
export async function getTeamQueueHealthCore(
  organisationId: string,
): Promise<TeamQueueHealth[]> {
  const isOpen = sql`${cases.status} <> 'closed'`;
  const age = sql`now() - ${cases.openedAt}`;
  const weightedScore = sql<number>`coalesce(sum(${severityWeightExpr()}) filter (where ${isOpen}), 0)`;

  // Same "at risk or breached" logic as src/app/(app)/cases/page.tsx's
  // `slaRisk`, reimplemented here rather than imported (the page component
  // is owned by another worker).
  const slaAtRiskExpr = sql`(
    ${cases.status} <> 'closed'
    AND EXISTS (
      SELECT 1
      FROM ${slaPolicies}
      WHERE ${slaPolicies.organisationId} = ${cases.organisationId}
        AND ${slaPolicies.severity} = ${cases.severity}
        AND (
          (${cases.acknowledgedAt} IS NULL AND ${cases.openedAt} + (${slaPolicies.timeToAcknowledgeMinutes} * interval '1 minute') <= now() + interval '15 minutes')
          OR (${cases.containedAt} IS NULL AND ${cases.openedAt} + (${slaPolicies.timeToContainMinutes} * interval '1 minute') <= now() + interval '15 minutes')
          OR (${cases.resolvedAt} IS NULL AND ${cases.openedAt} + (${slaPolicies.timeToResolveMinutes} * interval '1 minute') <= now() + interval '15 minutes')
        )
    )
  )`;

  const rows = await db
    .select({
      teamId: teams.id,
      teamName: teams.name,
      openCount: sql<number>`count(*) filter (where ${isOpen})`,
      unassignedCount: sql<number>`count(*) filter (where ${isOpen} and ${cases.assigneeId} is null)`,
      weightedScore,
      bucket0to24h: sql<number>`count(*) filter (where ${isOpen} and ${age} <= interval '1 day')`,
      bucket1to3d: sql<number>`count(*) filter (where ${isOpen} and ${age} > interval '1 day' and ${age} <= interval '3 days')`,
      bucket3to7d: sql<number>`count(*) filter (where ${isOpen} and ${age} > interval '3 days' and ${age} <= interval '7 days')`,
      bucket7dPlus: sql<number>`count(*) filter (where ${isOpen} and ${age} > interval '7 days')`,
      slaAtRisk: sql<number>`count(*) filter (where ${slaAtRiskExpr})`,
    })
    .from(teams)
    .leftJoin(cases, eq(cases.queueId, teams.id))
    .where(and(eq(teams.organisationId, organisationId), eq(teams.isActive, true)))
    .groupBy(teams.id, teams.name)
    .orderBy(teams.name);

  return rows.map((row) => ({
    teamId: row.teamId,
    teamName: row.teamName,
    openCount: Number(row.openCount),
    unassignedCount: Number(row.unassignedCount),
    weightedScore: Number(row.weightedScore),
    agingBuckets: {
      "0-24h": Number(row.bucket0to24h),
      "1-3d": Number(row.bucket1to3d),
      "3-7d": Number(row.bucket3to7d),
      "7d+": Number(row.bucket7dPlus),
    },
    slaAtRisk: Number(row.slaAtRisk),
  }));
}

/**
 * Non-closed cases with no queue AND no assignee — truly untriaged work that
 * hasn't even reached a team's queue yet.
 */
export async function getOrgUnassignedQueueCount(
  organisationId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(cases)
    .where(
      and(
        eq(cases.organisationId, organisationId),
        sql`${cases.status} <> 'closed'`,
        sql`${cases.queueId} is null`,
        sql`${cases.assigneeId} is null`,
      ),
    );
  return Number(row?.total ?? 0);
}

/** Count of non-closed cases the given user is watching. */
export async function getOrgWatchedCaseCount(
  organisationId: string,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(caseWatchers)
    .innerJoin(cases, eq(cases.id, caseWatchers.caseId))
    .where(
      and(
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.userId, userId),
        sql`${cases.status} <> 'closed'`,
      ),
    );
  return Number(row?.total ?? 0);
}
