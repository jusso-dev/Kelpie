import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations, enrichmentRuns } from "@/db/schema";
import { newId } from "@/lib/utils";
import { pollFeed } from "@/lib/ti/core";
import { pollCaseSource } from "@/lib/case-sources/core";
import { processPendingDeliveries } from "@/lib/webhooks";
import { enrichOrganisationPending } from "@/lib/enrichment/registry";
import { purgeExpiredCache } from "@/lib/enrichment/cache";
import { dispatchPendingMobilePushes } from "@/lib/mobile-push";
import { pruneStalePresence } from "@/lib/presence";
import { runSlaChecks } from "@/lib/sla-runner";
import { runEscalationPolicies } from "@/lib/escalation-core";
import { processPendingAutomationRuns } from "@/lib/automations/dispatch";
import { scanPendingEvidence } from "@/lib/evidence/scan-runner";
import { purgeExpiredAuditExports } from "@/lib/audit/export";
import { runAuditRetention } from "@/lib/audit/retention";

export async function pollThreatFeed(feedId: string) {
  const result = await pollFeed(feedId);
  if (result.error) throw new Error(result.error);
  return result;
}

export async function pollExternalCaseSource(sourceId: string) {
  const result = await pollCaseSource(sourceId);
  if (result.error) throw new Error(result.error);
  return result;
}

/**
 * Records one durable `enrichment_runs` row per organisation per sweep so the
 * run console (issue #67) has a real queryable record of this scheduled job,
 * rather than inventing a generic execution log. The enrichment logic itself
 * (`enrichOrganisationPending`) is untouched; this only wraps it.
 */
async function enrichOrganisationWithRunRecord(organisationId: string): Promise<number> {
  const id = newId("enr");
  await db.insert(enrichmentRuns).values({
    id,
    organisationId,
    status: "running",
    startedAt: new Date(),
  });
  try {
    const result = await enrichOrganisationPending(organisationId, 50);
    await db
      .update(enrichmentRuns)
      .set({
        status: "succeeded",
        processedCount: result.enriched,
        finishedAt: new Date(),
      })
      .where(eq(enrichmentRuns.id, id));
    return result.enriched;
  } catch (error) {
    await db
      .update(enrichmentRuns)
      .set({
        status: "failed",
        errorCategory: "provider_error",
        lastError: error instanceof Error ? error.message : "enrichment sweep failed",
        finishedAt: new Date(),
      })
      .where(eq(enrichmentRuns.id, id));
    throw error;
  }
}

export async function enrichPendingCases() {
  await purgeExpiredCache();
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  let enriched = 0;
  for (const organisation of orgs) {
    enriched += await enrichOrganisationWithRunRecord(organisation.id);
  }
  return { enriched, organisations: orgs.length };
}

export async function purgeAuditData() {
  const retention = await runAuditRetention();
  const exports = await purgeExpiredAuditExports();
  return { ...retention, exportsPurged: exports.purged };
}

export const jobHandlers = {
  "sla-check": runSlaChecks,
  "escalation-check": runEscalationPolicies,
  "deliver-webhooks": processPendingDeliveries,
  "deliver-automations": processPendingAutomationRuns,
  "enrich-cases": enrichPendingCases,
  "deliver-mobile-push": dispatchPendingMobilePushes,
  "prune-presence": pruneStalePresence,
  "scan-evidence": scanPendingEvidence,
  "purge-audit-events": purgeAuditData,
};
