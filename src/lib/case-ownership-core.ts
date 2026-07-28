/**
 * Core case-ownership mutations, callable from both server actions and API
 * routes. Callers must already have resolved `organisationId` for the
 * acting user/token; every function re-verifies that any case/user/team id
 * it touches belongs to that organisation before doing anything with it.
 *
 * Covers: queue assignment, the primary analyst assignee, additional
 * (secondary) assignees, explicit acknowledgement, and immutable shift
 * hand-offs. Watcher management lives in `watchers-core.ts`.
 */

import { db } from "@/db";
import {
  cases,
  caseAssignees,
  caseHandoffs,
  teams,
  users,
  type CaseHandoff,
} from "@/db/schema";
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";
import { CaseVersionConflictError } from "./cases-core";
import { sendEmail } from "./email";
import { queueMobilePushForUsers } from "./mobile-push";
import { notifyWatchers } from "./case-notifications";

export class CaseOwnershipError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "CaseOwnershipError";
    this.status = status;
  }
}

type CaseRow = typeof cases.$inferSelect;

type CaseUpdateSet = Omit<Partial<typeof cases.$inferInsert>, "version"> & {
  version?: number | SQL;
};

async function loadCaseInOrg(
  caseId: string,
  organisationId: string,
): Promise<CaseRow | null> {
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

async function loadUserInOrg(userId: string, organisationId: string) {
  const [u] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  return u ?? null;
}

async function loadTeamInOrg(teamId: string, organisationId: string) {
  const [t] = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.organisationId, organisationId)))
    .limit(1);
  return t ?? null;
}

function caseSnapshot(existing: CaseRow): Record<string, unknown> {
  return {
    version: existing.version,
    status: existing.status,
    severity: existing.severity,
    assigneeId: existing.assigneeId,
    queueId: existing.queueId,
    tags: existing.tags,
    acknowledgedAt: existing.acknowledgedAt,
  };
}

async function updateCaseAtomically(
  caseId: string,
  organisationId: string,
  set: CaseUpdateSet,
  expectedVersion?: number,
): Promise<{ version: number } | null> {
  const conditions = [eq(cases.id, caseId), eq(cases.organisationId, organisationId)];
  if (expectedVersion !== undefined) {
    conditions.push(eq(cases.version, expectedVersion));
  }
  const [updated] = await db
    .update(cases)
    .set(set)
    .where(and(...conditions))
    .returning({ version: cases.version });
  return updated ?? null;
}

/**
 * Best-effort direct notification (email + mobile push) to the specific
 * users transferring/receiving ownership in a hand-off. This is separate
 * from `notifyWatchers`, since the outgoing/incoming assignee may not be a
 * case watcher. Never throws.
 */
async function notifyHandoffParticipants(params: {
  organisationId: string;
  caseId: string;
  caseNumber: string;
  actorId: string | null;
  recipientIds: Array<string | null | undefined>;
  note: string;
}): Promise<void> {
  try {
    const recipientIds = [
      ...new Set(
        params.recipientIds.filter(
          (v): v is string => Boolean(v) && v !== params.actorId,
        ),
      ),
    ];
    if (recipientIds.length === 0) return;
    const recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, recipientIds));
    const subject = `Case ${params.caseNumber} hand-off`;
    for (const recipient of recipients) {
      try {
        await sendEmail({ to: recipient.email, subject, text: params.note });
      } catch {
        // Continue notifying other participants even if one delivery fails.
      }
    }
    try {
      await queueMobilePushForUsers(params.organisationId, recipientIds, {
        event: "handoff_created",
        sourceId: `${params.caseId}:handoff:${Date.now()}`,
        title: subject,
        body: params.note,
        destinationType: "case",
        destinationId: params.caseId,
      });
    } catch {
      // Mobile push is best-effort.
    }
  } catch {
    // A hand-off must never fail because a notification could not be sent.
  }
}

export async function assignCaseQueueCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  queueId: string | null,
  expectedVersion?: number,
): Promise<{ version: number }> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new CaseOwnershipError("Case not found", 404);
  if (expectedVersion !== undefined && expectedVersion !== existing.version) {
    throw new CaseVersionConflictError(caseSnapshot(existing));
  }
  if (queueId) {
    const team = await loadTeamInOrg(queueId, organisationId);
    if (!team) throw new CaseOwnershipError("Queue not found", 404);
  }
  if (existing.queueId === queueId) return { version: existing.version };

  const now = new Date();
  const updated = await updateCaseAtomically(
    caseId,
    organisationId,
    {
      queueId,
      queueAssignedAt: queueId ? now : null,
      queueAssignedBy: queueId ? actorId : null,
      version:
        expectedVersion === undefined ? sql`${cases.version} + 1` : existing.version + 1,
    },
    expectedVersion,
  );
  if (!updated) {
    const current = await loadCaseInOrg(caseId, organisationId);
    if (!current) throw new CaseOwnershipError("Case not found", 404);
    throw new CaseVersionConflictError(caseSnapshot(current));
  }
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "queue_assignment_change",
    payload: { from: existing.queueId, to: queueId },
  });
  try {
    await notifyWatchers({
      organisationId,
      caseId,
      event: "assignment",
      excludeUserId: actorId,
      subject: `Case ${existing.caseNumber} queue updated`,
      body: queueId
        ? "This case has been moved to a new queue."
        : "This case has been removed from its queue.",
    });
  } catch {
    // Watcher notification failures must never fail the queue assignment.
  }
  return updated;
}

export async function assignCaseAnalystCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  assigneeId: string | null,
  expectedVersion?: number,
): Promise<{ version: number }> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new CaseOwnershipError("Case not found", 404);
  if (expectedVersion !== undefined && expectedVersion !== existing.version) {
    throw new CaseVersionConflictError(caseSnapshot(existing));
  }
  if (assigneeId) {
    const user = await loadUserInOrg(assigneeId, organisationId);
    if (!user) throw new CaseOwnershipError("Assignee not found", 404);
  }
  if (existing.assigneeId === assigneeId) return { version: existing.version };

  const now = new Date();
  const updated = await updateCaseAtomically(
    caseId,
    organisationId,
    {
      assigneeId,
      assigneeAssignedAt: assigneeId ? now : null,
      version:
        expectedVersion === undefined ? sql`${cases.version} + 1` : existing.version + 1,
    },
    expectedVersion,
  );
  if (!updated) {
    const current = await loadCaseInOrg(caseId, organisationId);
    if (!current) throw new CaseOwnershipError("Case not found", 404);
    throw new CaseVersionConflictError(caseSnapshot(current));
  }
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "assignment_change",
    payload: { from: existing.assigneeId, to: assigneeId },
  });
  try {
    await notifyWatchers({
      organisationId,
      caseId,
      event: "assignment",
      excludeUserId: actorId,
      subject: `Case ${existing.caseNumber} assignee updated`,
      body: assigneeId
        ? "This case has been assigned to a new analyst."
        : "This case's assignee has been cleared.",
    });
  } catch {
    // Watcher notification failures must never fail the assignment.
  }
  return updated;
}

export async function acknowledgeCaseCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
): Promise<{ acknowledgedAt: Date; alreadyAcknowledged: boolean }> {
  const [updated] = await db
    .update(cases)
    .set({ acknowledgedAt: sql`now()`, acknowledgedBy: actorId })
    .where(
      and(
        eq(cases.id, caseId),
        eq(cases.organisationId, organisationId),
        isNull(cases.acknowledgedAt),
      ),
    )
    .returning({ acknowledgedAt: cases.acknowledgedAt });
  if (updated) {
    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: "acknowledged",
      payload: {},
    });
    return { acknowledgedAt: updated.acknowledgedAt as Date, alreadyAcknowledged: false };
  }
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new CaseOwnershipError("Case not found", 404);
  // The update above only matches rows where acknowledgedAt is still null, so
  // reaching here with a case that exists in-org means it was already
  // acknowledged (possibly by a concurrent request) — return that value
  // idempotently without writing a duplicate timeline entry.
  return {
    acknowledgedAt: (existing.acknowledgedAt as Date) ?? new Date(),
    alreadyAcknowledged: true,
  };
}

export async function addAdditionalAssigneeCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  userId: string,
): Promise<{ id: string }> {
  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new CaseOwnershipError("Case not found", 404);
  const user = await loadUserInOrg(userId, organisationId);
  if (!user) throw new CaseOwnershipError("User not found", 404);

  const id = newId("caseassignee");
  const [inserted] = await db
    .insert(caseAssignees)
    .values({ id, caseId, organisationId, userId, addedBy: actorId })
    .onConflictDoNothing()
    .returning({ id: caseAssignees.id });
  if (inserted) {
    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: "additional_assignee_added",
      payload: { userId },
    });
    return { id: inserted.id };
  }
  const [row] = await db
    .select({ id: caseAssignees.id })
    .from(caseAssignees)
    .where(and(eq(caseAssignees.caseId, caseId), eq(caseAssignees.userId, userId)))
    .limit(1);
  if (!row) throw new CaseOwnershipError("Additional assignee not found", 404);
  return { id: row.id };
}

export async function removeAdditionalAssigneeCore(
  organisationId: string,
  caseId: string,
  userId: string,
): Promise<void> {
  const deleted = await db
    .delete(caseAssignees)
    .where(
      and(
        eq(caseAssignees.caseId, caseId),
        eq(caseAssignees.organisationId, organisationId),
        eq(caseAssignees.userId, userId),
      ),
    )
    .returning({ id: caseAssignees.id });
  if (deleted.length > 0) {
    await writeTimelineEvent({
      caseId,
      actorId: null,
      eventType: "additional_assignee_removed",
      payload: { userId },
    });
  }
}

export async function listAdditionalAssigneesCore(
  organisationId: string,
  caseId: string,
): Promise<Array<{ userId: string; name: string; email: string; addedAt: Date }>> {
  return db
    .select({
      userId: caseAssignees.userId,
      name: users.name,
      email: users.email,
      addedAt: caseAssignees.addedAt,
    })
    .from(caseAssignees)
    .innerJoin(users, eq(users.id, caseAssignees.userId))
    .where(
      and(eq(caseAssignees.caseId, caseId), eq(caseAssignees.organisationId, organisationId)),
    );
}

export type CreateHandoffInput = {
  toUserId?: string | null;
  toQueueId?: string | null;
  note: string;
};

export async function createHandoffCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: CreateHandoffInput,
): Promise<{ id: string }> {
  const note = input.note?.trim() ?? "";
  if (!note) throw new CaseOwnershipError("A note is required for a hand-off", 400);
  const toUserId = input.toUserId ?? null;
  const toQueueId = input.toQueueId ?? null;
  if (!toUserId && !toQueueId) {
    throw new CaseOwnershipError(
      "A hand-off must transfer ownership to a user or a queue",
      400,
    );
  }

  const existing = await loadCaseInOrg(caseId, organisationId);
  if (!existing) throw new CaseOwnershipError("Case not found", 404);
  if (toUserId) {
    const user = await loadUserInOrg(toUserId, organisationId);
    if (!user) throw new CaseOwnershipError("Target user not found", 404);
  }
  if (toQueueId) {
    const team = await loadTeamInOrg(toQueueId, organisationId);
    if (!team) throw new CaseOwnershipError("Target queue not found", 404);
  }

  const snapshot = {
    status: existing.status,
    severity: existing.severity,
    assigneeId: existing.assigneeId,
    queueId: existing.queueId,
    tags: existing.tags,
    acknowledgedAt: existing.acknowledgedAt,
  };

  const id = newId("handoff");
  await db.insert(caseHandoffs).values({
    id,
    caseId,
    organisationId,
    fromUserId: existing.assigneeId,
    toUserId,
    toQueueId,
    note,
    snapshot,
    createdBy: actorId,
  });

  if (toUserId) {
    await assignCaseAnalystCore(organisationId, actorId, caseId, toUserId);
  }
  if (toQueueId) {
    await assignCaseQueueCore(organisationId, actorId, caseId, toQueueId);
  }

  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "handoff_created",
    payload: { toUserId, toQueueId, note },
  });

  await notifyHandoffParticipants({
    organisationId,
    caseId,
    caseNumber: existing.caseNumber,
    actorId,
    recipientIds: [existing.assigneeId, toUserId],
    note,
  });

  return { id };
}

export async function listHandoffsCore(
  organisationId: string,
  caseId: string,
): Promise<CaseHandoff[]> {
  return db
    .select()
    .from(caseHandoffs)
    .where(and(eq(caseHandoffs.caseId, caseId), eq(caseHandoffs.organisationId, organisationId)))
    .orderBy(desc(caseHandoffs.createdAt));
}
