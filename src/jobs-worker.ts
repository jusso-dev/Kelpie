import { Worker, type Job } from "bullmq";
import {
  createKelpieQueue,
  KELPIE_QUEUE,
  redisConnection,
  type KelpieJobData,
} from "@/lib/jobs/queue";
import {
  syncSourceSchedulers,
  upsertSystemSchedulers,
} from "@/lib/jobs/schedulers";
import {
  enrichPendingCases,
  jobHandlers,
  pollExternalCaseSource,
  pollThreatFeed,
} from "@/lib/jobs/handlers";
import { processAuditExportJob } from "@/lib/audit/export";
import {
  refreshAttackCatalogFromBundled,
  refreshAttackCatalogFromUrl,
} from "@/lib/attack/refresh-job";

const queue = createKelpieQueue();

function workerConcurrency(): number {
  const value = Number(process.env.JOBS_CONCURRENCY ?? 5);
  return Number.isInteger(value) && value >= 1 && value <= 50 ? value : 5;
}

async function processJob(job: Job<KelpieJobData, unknown, string>) {
  switch (job.name) {
    case "schedule-sync":
      return syncSourceSchedulers(queue);
    case "poll-ti-feed":
      if (!job.data.feedId) throw new Error("TI feed job is missing feedId");
      return pollThreatFeed(job.data.feedId);
    case "poll-case-source":
      if (!job.data.sourceId) throw new Error("Case-source job is missing sourceId");
      return pollExternalCaseSource(job.data.sourceId);
    case "enrich-cases":
      return enrichPendingCases();
    case "export-audit-events":
      if (!job.data.auditExportJobId) {
        throw new Error("Audit export job is missing auditExportJobId");
      }
      return processAuditExportJob(job.data.auditExportJobId);
    case "refresh-attack-catalog":
      return job.data.attackCatalogSourceUrl
        ? refreshAttackCatalogFromUrl(
            job.data.attackCatalogSourceUrl,
            job.data.attackCatalogActorId ?? null,
          )
        : refreshAttackCatalogFromBundled(job.data.attackCatalogActorId ?? null);
    case "sla-check":
    case "escalation-check":
    case "deliver-webhooks":
    case "deliver-automations":
    case "deliver-mobile-push":
    case "prune-presence":
    case "scan-evidence":
    case "purge-audit-events":
      return jobHandlers[job.name]();
    default:
      throw new Error(`Unsupported Kelpie job: ${job.name}`);
  }
}

async function start() {
  await upsertSystemSchedulers(queue);
  const synced = await syncSourceSchedulers(queue);
  console.info("Kelpie job schedules ready", synced);

  const worker = new Worker<KelpieJobData, unknown, string>(
    KELPIE_QUEUE,
    processJob,
    {
      connection: redisConnection(true),
      concurrency: workerConcurrency(),
    },
  );

  worker.on("completed", (job) => {
    console.info("Kelpie job completed", { id: job.id, name: job.name });
  });
  worker.on("failed", (job, error) => {
    console.error("Kelpie job failed", {
      id: job?.id,
      name: job?.name,
      attempt: job?.attemptsMade,
      error: error.message,
    });
  });
  worker.on("error", (error) => {
    console.error("Kelpie worker error", error);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Kelpie worker received ${signal}; finishing active jobs`);
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

start().catch(async (error) => {
  console.error("Kelpie worker failed to start", error);
  await queue.close().catch(() => {});
  process.exit(1);
});
