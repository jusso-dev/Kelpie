import { db } from "@/db";
import { casePresence } from "@/db/schema";
import { and, eq, gt, lt } from "drizzle-orm";
import { newId } from "./utils";

/** A presence row is considered live if seen within this window. */
export const PRESENCE_TTL_MS = 30000;

export type PresenceEntry = {
  userId: string;
  userName: string;
  editingField: string | null;
  typing: boolean;
  lastSeenAt: string;
};

export async function heartbeat(opts: {
  caseId: string;
  userId: string;
  userName: string;
  editingField?: string | null;
  typing?: boolean;
}): Promise<void> {
  await db
    .insert(casePresence)
    .values({
      id: newId("pres"),
      caseId: opts.caseId,
      userId: opts.userId,
      userName: opts.userName,
      editingField: opts.editingField ?? null,
      typing: opts.typing ?? false,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [casePresence.caseId, casePresence.userId],
      set: {
        userName: opts.userName,
        editingField: opts.editingField ?? null,
        typing: opts.typing ?? false,
        lastSeenAt: new Date(),
      },
    });
}

export async function leave(caseId: string, userId: string): Promise<void> {
  await db
    .delete(casePresence)
    .where(
      and(eq(casePresence.caseId, caseId), eq(casePresence.userId, userId)),
    );
}

export async function getRoster(
  caseId: string,
  excludeUserId?: string,
): Promise<PresenceEntry[]> {
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS);
  const rows = await db
    .select()
    .from(casePresence)
    .where(
      and(eq(casePresence.caseId, caseId), gt(casePresence.lastSeenAt, cutoff)),
    );
  return rows
    .filter((r) => r.userId !== excludeUserId)
    .map((r) => ({
      userId: r.userId,
      userName: r.userName,
      editingField: r.editingField,
      typing: r.typing,
      lastSeenAt: r.lastSeenAt.toISOString(),
    }));
}

/** Best-effort prune of stale rows so the table does not grow unbounded. */
export async function pruneStalePresence(): Promise<void> {
  const cutoff = new Date(Date.now() - PRESENCE_TTL_MS * 4);
  await db.delete(casePresence).where(lt(casePresence.lastSeenAt, cutoff));
}
