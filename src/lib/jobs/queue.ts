import { Queue, type ConnectionOptions, type JobsOptions } from "bullmq";

export const KELPIE_QUEUE = "kelpie-jobs";

export type KelpieJobName =
  | "schedule-sync"
  | "poll-ti-feed"
  | "poll-case-source"
  | "poll-mailbox"
  | "sla-check"
  | "escalation-check"
  | "deliver-webhooks"
  | "deliver-automations"
  | "enrich-cases"
  | "deliver-mobile-push"
  | "prune-presence"
  | "scan-evidence"
  | "export-audit-events"
  | "purge-audit-events"
  | "refresh-attack-catalog";

export type KelpieJobData = {
  feedId?: string;
  sourceId?: string;
  mailboxConnectionId?: string;
  auditExportJobId?: string;
  attackCatalogSourceUrl?: string;
  attackCatalogActorId?: string;
};

export function redisConnection(worker = false): ConnectionOptions {
  const value = process.env.REDIS_URL?.trim() || "redis://localhost:6379";
  const url = new URL(value);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    throw new Error("REDIS_URL must use redis:// or rediss://");
  }
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isInteger(database) ? database : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: worker ? null : 20,
  };
}

export function createKelpieQueue() {
  return new Queue<KelpieJobData, unknown, string>(KELPIE_QUEUE, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
    },
  });
}

export const scheduledJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
};
