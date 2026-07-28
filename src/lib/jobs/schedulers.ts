import type { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { caseSources, mailboxConnections, tiFeeds } from "@/db/schema";
import {
  type KelpieJobData,
  type KelpieJobName,
  scheduledJobOptions,
} from "@/lib/jobs/queue";

type KelpieQueue = Queue<KelpieJobData, unknown, string>;

const SYSTEM_SCHEDULES: Array<{
  id: string;
  every: number;
  name: KelpieJobName;
}> = [
  { id: "system:schedule-sync", every: 60_000, name: "schedule-sync" },
  { id: "system:sla-check", every: 60_000, name: "sla-check" },
  { id: "system:escalation-check", every: 60_000, name: "escalation-check" },
  { id: "system:deliver-webhooks", every: 60_000, name: "deliver-webhooks" },
  { id: "system:deliver-automations", every: 60_000, name: "deliver-automations" },
  { id: "system:enrich-cases", every: 60_000, name: "enrich-cases" },
  { id: "system:deliver-mobile-push", every: 60_000, name: "deliver-mobile-push" },
  { id: "system:prune-presence", every: 60_000, name: "prune-presence" },
  { id: "system:scan-evidence", every: 15_000, name: "scan-evidence" },
  {
    id: "system:purge-audit-events",
    every: 24 * 60 * 60_000,
    name: "purge-audit-events",
  },
  {
    id: "system:run-report-schedules",
    every: 60_000,
    name: "run-report-schedules",
  },
];

export async function upsertSystemSchedulers(queue: KelpieQueue) {
  await Promise.all(
    SYSTEM_SCHEDULES.map((schedule) =>
      queue.upsertJobScheduler(
        schedule.id,
        { every: schedule.every },
        {
          name: schedule.name,
          data: {},
          opts: scheduledJobOptions,
        },
      ),
    ),
  );
}

export async function syncSourceSchedulers(queue: KelpieQueue): Promise<{
  feeds: number;
  caseSources: number;
  mailboxes: number;
  removed: number;
}> {
  const [feeds, sources, mailboxes] = await Promise.all([
    db
      .select({
        id: tiFeeds.id,
        intervalMinutes: tiFeeds.pollIntervalMinutes,
      })
      .from(tiFeeds)
      .where(eq(tiFeeds.isActive, true)),
    db
      .select({
        id: caseSources.id,
        intervalMinutes: caseSources.pollIntervalMinutes,
      })
      .from(caseSources)
      .where(eq(caseSources.isActive, true)),
    db
      .select({
        id: mailboxConnections.id,
        intervalMinutes: mailboxConnections.pollIntervalMinutes,
      })
      .from(mailboxConnections)
      .where(eq(mailboxConnections.isActive, true)),
  ]);

  const desired = new Set<string>();
  await Promise.all([
    ...feeds.map((feed) => {
      const schedulerId = `ti:${feed.id}`;
      desired.add(schedulerId);
      return queue.upsertJobScheduler(
        schedulerId,
        { every: Math.max(5, feed.intervalMinutes) * 60_000 },
        {
          name: "poll-ti-feed",
          data: { feedId: feed.id },
          opts: scheduledJobOptions,
        },
      );
    }),
    ...sources.map((source) => {
      const schedulerId = `case-source:${source.id}`;
      desired.add(schedulerId);
      return queue.upsertJobScheduler(
        schedulerId,
        { every: Math.max(1, source.intervalMinutes) * 60_000 },
        {
          name: "poll-case-source",
          data: { sourceId: source.id },
          opts: scheduledJobOptions,
        },
      );
    }),
    ...mailboxes.map((mailbox) => {
      const schedulerId = `mailbox:${mailbox.id}`;
      desired.add(schedulerId);
      return queue.upsertJobScheduler(
        schedulerId,
        { every: Math.max(1, mailbox.intervalMinutes) * 60_000 },
        {
          name: "poll-mailbox",
          data: { mailboxConnectionId: mailbox.id },
          opts: scheduledJobOptions,
        },
      );
    }),
  ]);

  const existing = await queue.getJobSchedulers(0, -1, true);
  const obsolete = existing
    .map((scheduler) => scheduler.key)
    .filter(
      (key) =>
        (key.startsWith("ti:") ||
          key.startsWith("case-source:") ||
          key.startsWith("mailbox:")) &&
        !desired.has(key),
    );
  await Promise.all(obsolete.map((key) => queue.removeJobScheduler(key)));

  return {
    feeds: feeds.length,
    caseSources: sources.length,
    mailboxes: mailboxes.length,
    removed: obsolete.length,
  };
}
