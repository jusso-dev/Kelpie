/**
 * Best-effort case-watcher notification fan-out. This module must never be
 * able to fail the case mutation that triggered it — every failure mode is
 * swallowed (and logged) rather than thrown.
 */

import { db } from "@/db";
import { caseWatchers, users } from "@/db/schema";
import { and, eq, inArray, ne, type Column } from "drizzle-orm";
import { sendEmail } from "./email";
import { queueMobilePushForUsers } from "./mobile-push";

export type WatcherNotificationEvent =
  | "comment"
  | "status_change"
  | "assignment"
  | "escalation"
  | "handoff";

const EVENT_COLUMN: Record<WatcherNotificationEvent, Column> = {
  comment: caseWatchers.notifyOnComment,
  status_change: caseWatchers.notifyOnStatusChange,
  assignment: caseWatchers.notifyOnAssignment,
  escalation: caseWatchers.notifyOnEscalation,
  handoff: caseWatchers.notifyOnAssignment,
};

export async function notifyWatchers(input: {
  organisationId: string;
  caseId: string;
  event: WatcherNotificationEvent;
  excludeUserId?: string | null;
  subject: string;
  body: string;
}): Promise<{ notified: number }> {
  try {
    const column = EVENT_COLUMN[input.event];
    const conditions = [
      eq(caseWatchers.caseId, input.caseId),
      eq(caseWatchers.organisationId, input.organisationId),
      eq(column, true),
    ];
    if (input.excludeUserId) {
      conditions.push(ne(caseWatchers.userId, input.excludeUserId));
    }
    const watcherRows = await db
      .select({ userId: caseWatchers.userId })
      .from(caseWatchers)
      .where(and(...conditions));
    if (watcherRows.length === 0) return { notified: 0 };

    const userIds = [...new Set(watcherRows.map((w) => w.userId))];
    const recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, userIds));

    for (const recipient of recipients) {
      try {
        await sendEmail({ to: recipient.email, subject: input.subject, text: input.body });
      } catch (err) {
        // Continue notifying remaining watchers even if one delivery fails.
        console.error("[case-notifications] email delivery failed", err);
      }
    }

    try {
      await queueMobilePushForUsers(input.organisationId, userIds, {
        event: "watcher_notification",
        sourceId: `${input.caseId}:${input.event}:${Date.now()}`,
        title: input.subject,
        body: input.body,
        destinationType: "case",
        destinationId: input.caseId,
      });
    } catch (err) {
      console.error("[case-notifications] mobile push queueing failed", err);
    }

    return { notified: recipients.length };
  } catch (err) {
    // Notifying watchers must never be able to fail the underlying case
    // mutation that triggered this call.
    console.error("[case-notifications] notifyWatchers failed", err);
    return { notified: 0 };
  }
}
