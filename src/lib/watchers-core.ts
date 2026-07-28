/**
 * Core case-watcher mutations and queries, callable from both server
 * actions and API routes. Callers must already have resolved
 * `organisationId` for the acting user/token; every function re-verifies
 * that the case and user ids it touches belong to that organisation before
 * doing anything with them.
 */

import { db } from "@/db";
import { cases, caseWatchers, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";

export class WatcherError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "WatcherError";
    this.status = status;
  }
}

export type WatcherPreferences = Partial<{
  notifyOnComment: boolean;
  notifyOnStatusChange: boolean;
  notifyOnAssignment: boolean;
  notifyOnEscalation: boolean;
}>;

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

async function loadUserInOrg(userId: string, organisationId: string) {
  const [u] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  return u ?? null;
}

// Watching a case is notification-only: it must never be used to grant or
// imply case read/write access (see the comment on the `caseWatchers` table
// in src/db/schema.ts). Access remains governed solely by organisation +
// role. Do not "fix" this later by wiring watcher status into any
// read/write access check.

export async function addWatcherCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  userId: string,
  preferences?: WatcherPreferences,
): Promise<{ id: string }> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new WatcherError("Case not found", 404);
  const userRow = await loadUserInOrg(userId, organisationId);
  if (!userRow) throw new WatcherError("User not found", 404);

  const id = newId("watcher");
  const [inserted] = await db
    .insert(caseWatchers)
    .values({
      id,
      caseId,
      organisationId,
      userId,
      addedBy: actorId,
      notifyOnComment: preferences?.notifyOnComment ?? true,
      notifyOnStatusChange: preferences?.notifyOnStatusChange ?? true,
      notifyOnAssignment: preferences?.notifyOnAssignment ?? true,
      notifyOnEscalation: preferences?.notifyOnEscalation ?? true,
    })
    .onConflictDoNothing()
    .returning({ id: caseWatchers.id });

  if (inserted) {
    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: "watcher_added",
      payload: { userId },
    });
    return { id: inserted.id };
  }

  // Already watching: this is a re-add, not a new watch, so it must never
  // error and must never emit a duplicate "watcher_added" timeline entry.
  // Merge in any preferences the caller provided.
  const [existingRow] = await db
    .select({ id: caseWatchers.id })
    .from(caseWatchers)
    .where(and(eq(caseWatchers.caseId, caseId), eq(caseWatchers.userId, userId)))
    .limit(1);
  if (!existingRow) throw new WatcherError("Watcher not found", 404);

  if (preferences && Object.keys(preferences).length > 0) {
    await db.update(caseWatchers).set(preferences).where(eq(caseWatchers.id, existingRow.id));
  }
  return { id: existingRow.id };
}

export async function removeWatcherCore(
  organisationId: string,
  caseId: string,
  userId: string,
): Promise<void> {
  const deleted = await db
    .delete(caseWatchers)
    .where(
      and(
        eq(caseWatchers.caseId, caseId),
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.userId, userId),
      ),
    )
    .returning({ id: caseWatchers.id });
  if (deleted.length > 0) {
    await writeTimelineEvent({
      caseId,
      actorId: null,
      eventType: "watcher_removed",
      payload: { userId },
    });
  }
}

export async function updateWatcherPreferencesCore(
  organisationId: string,
  caseId: string,
  userId: string,
  preferences: WatcherPreferences,
): Promise<void> {
  const updated = await db
    .update(caseWatchers)
    .set(preferences)
    .where(
      and(
        eq(caseWatchers.caseId, caseId),
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.userId, userId),
      ),
    )
    .returning({ id: caseWatchers.id });
  if (updated.length === 0) {
    throw new WatcherError("Watcher not found", 404);
  }
  // A pure preference change is not case-relevant history, so no timeline
  // entry is written here.
}

export async function listWatchersCore(
  organisationId: string,
  caseId: string,
): Promise<
  Array<{
    userId: string;
    name: string;
    email: string;
    notifyOnComment: boolean;
    notifyOnStatusChange: boolean;
    notifyOnAssignment: boolean;
    notifyOnEscalation: boolean;
    createdAt: Date;
  }>
> {
  return db
    .select({
      userId: caseWatchers.userId,
      name: users.name,
      email: users.email,
      notifyOnComment: caseWatchers.notifyOnComment,
      notifyOnStatusChange: caseWatchers.notifyOnStatusChange,
      notifyOnAssignment: caseWatchers.notifyOnAssignment,
      notifyOnEscalation: caseWatchers.notifyOnEscalation,
      createdAt: caseWatchers.createdAt,
    })
    .from(caseWatchers)
    .innerJoin(users, eq(users.id, caseWatchers.userId))
    .where(and(eq(caseWatchers.caseId, caseId), eq(caseWatchers.organisationId, organisationId)));
}

export async function isCaseWatcherCore(
  organisationId: string,
  caseId: string,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: caseWatchers.id })
    .from(caseWatchers)
    .where(
      and(
        eq(caseWatchers.caseId, caseId),
        eq(caseWatchers.organisationId, organisationId),
        eq(caseWatchers.userId, userId),
      ),
    )
    .limit(1);
  return !!row;
}
