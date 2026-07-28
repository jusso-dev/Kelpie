/**
 * Case watchers/subscribers. Watching is a notification preference only: it
 * never grants read or write access on a case. Access continues to be
 * governed purely by organisation membership and role (see
 * requireUser/requireRole in src/lib/session.ts); this module only ever
 * reads who asked to be notified and how, scoped to a case the caller's
 * organisation already owns.
 */
import { db } from "@/db";
import { cases, caseWatchers, users } from "@/db/schema";
import type { TimelineEventType } from "./timeline";
import { and, eq } from "drizzle-orm";
import { newId } from "./utils";
import { sendEmail } from "./email";
import { queueMobilePushForUsers } from "./mobile-push";

export type WatcherPreferences = {
  notifyOnComment: boolean;
  notifyOnStatusChange: boolean;
  notifyOnAssignment: boolean;
  notifyOnSlaRisk: boolean;
};

const DEFAULT_PREFERENCES: WatcherPreferences = {
  notifyOnComment: true,
  notifyOnStatusChange: true,
  notifyOnAssignment: true,
  notifyOnSlaRisk: true,
};

async function assertCaseInOrg(organisationId: string, caseId: string) {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new Error("Case not found");
}

async function assertUserInOrg(organisationId: string, userId: string) {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  if (!row) throw new Error("User is not a member of this organisation");
}

export async function addWatcherCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  userId: string,
  preferences: Partial<WatcherPreferences> = {},
): Promise<void> {
  await assertCaseInOrg(organisationId, caseId);
  await assertUserInOrg(organisationId, userId);
  const merged = { ...DEFAULT_PREFERENCES, ...preferences };
  await db
    .insert(caseWatchers)
    .values({
      id: newId("watch"),
      organisationId,
      caseId,
      userId,
      notifyOnComment: merged.notifyOnComment,
      notifyOnStatusChange: merged.notifyOnStatusChange,
      notifyOnAssignment: merged.notifyOnAssignment,
      notifyOnSlaRisk: merged.notifyOnSlaRisk,
      addedBy: actorId,
    })
    .onConflictDoNothing();
}

export async function removeWatcherCore(
  organisationId: string,
  caseId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(caseWatchers)
    .where(
      and(
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.caseId, caseId),
        eq(caseWatchers.userId, userId),
      ),
    );
}

export async function updateWatcherPreferencesCore(
  organisationId: string,
  caseId: string,
  userId: string,
  preferences: Partial<WatcherPreferences>,
): Promise<void> {
  await db
    .update(caseWatchers)
    .set(preferences)
    .where(
      and(
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.caseId, caseId),
        eq(caseWatchers.userId, userId),
      ),
    );
}

export async function listWatchersCore(organisationId: string, caseId: string) {
  await assertCaseInOrg(organisationId, caseId);
  return db
    .select({
      userId: caseWatchers.userId,
      userName: users.name,
      userEmail: users.email,
      notifyOnComment: caseWatchers.notifyOnComment,
      notifyOnStatusChange: caseWatchers.notifyOnStatusChange,
      notifyOnAssignment: caseWatchers.notifyOnAssignment,
      notifyOnSlaRisk: caseWatchers.notifyOnSlaRisk,
      createdAt: caseWatchers.createdAt,
    })
    .from(caseWatchers)
    .innerJoin(users, eq(users.id, caseWatchers.userId))
    .where(
      and(
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.caseId, caseId),
      ),
    );
}

/** Cases (ids only) that this user watches within their own organisation. */
export async function listWatchedCaseIdsCore(
  organisationId: string,
  userId: string,
): Promise<string[]> {
  const rows = await db
    .select({ caseId: caseWatchers.caseId })
    .from(caseWatchers)
    .where(
      and(
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.userId, userId),
      ),
    );
  return rows.map((r) => r.caseId);
}

function preferenceFieldFor(
  eventType: TimelineEventType,
  payload: Record<string, unknown>,
): keyof WatcherPreferences | null {
  switch (eventType) {
    case "comment":
      return "notifyOnComment";
    case "status_change":
      return "notifyOnStatusChange";
    case "assignment_change":
    case "queue_assignment_change":
      return "notifyOnAssignment";
    case "sla_breach":
      return "notifyOnSlaRisk";
    case "custom":
      return payload.kind === "sla_warning" ? "notifyOnSlaRisk" : null;
    default:
      return null;
  }
}

/**
 * Notify every watcher on a case whose own preference flag matches this
 * timeline event, respecting only what each watcher already opted into.
 * Never used to determine who *can* read the case -- that remains
 * organisation membership plus role.
 */
export async function notifyWatchersForEvent(input: {
  caseId: string;
  organisationId: string;
  caseNumber: string;
  caseTitle: string;
  actorId: string | null;
  eventType: TimelineEventType;
  payload: Record<string, unknown>;
}): Promise<void> {
  const field = preferenceFieldFor(input.eventType, input.payload);
  if (!field) return;
  const watchers = await db
    .select({
      userId: caseWatchers.userId,
      userEmail: users.email,
      enabled: caseWatchers[field],
    })
    .from(caseWatchers)
    .innerJoin(users, eq(users.id, caseWatchers.userId))
    .where(
      and(
        eq(caseWatchers.organisationId, input.organisationId),
        eq(caseWatchers.caseId, input.caseId),
      ),
    );
  const recipients = watchers.filter(
    (w) => w.enabled && w.userId !== input.actorId,
  );
  if (recipients.length === 0) return;
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${input.caseId}`;
  await Promise.all(
    recipients.map((recipient) =>
      sendEmail({
        to: recipient.userEmail,
        subject: `[Kelpie] ${input.caseNumber} updated`,
        text:
          `${input.caseNumber} — ${input.caseTitle}\n` +
          `You are watching this case and asked to be notified about this kind of update.\n` +
          `${url}\n`,
      }).catch(() => {
        // Best-effort: a delivery failure must not affect the watch list.
      }),
    ),
  );
  await queueMobilePushForUsers(
    input.organisationId,
    recipients.map((r) => r.userId),
    {
      event: "case_watch_update",
      sourceId: `${input.caseId}:${input.eventType}:${Date.now()}`,
      title: "Kelpie case update",
      body: `${input.caseNumber} was updated on a case you are watching.`,
      destinationType: "case",
      destinationId: input.caseId,
    },
  );
}
