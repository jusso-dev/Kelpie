import { db } from "@/db";
import { organisations } from "@/db/schema";
import { pollFeed } from "@/lib/ti/core";
import { pollCaseSource } from "@/lib/case-sources/core";
import { processPendingDeliveries } from "@/lib/webhooks";
import { enrichOrganisationPending } from "@/lib/enrichment/registry";
import { purgeExpiredCache } from "@/lib/enrichment/cache";
import { dispatchPendingMobilePushes } from "@/lib/mobile-push";
import { pruneStalePresence } from "@/lib/presence";
import { runSlaChecks } from "@/lib/sla-runner";
import { runEscalationChecks } from "@/lib/escalation-runner";
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

export async function enrichPendingCases() {
  await purgeExpiredCache();
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  let enriched = 0;
  for (const organisation of orgs) {
    const result = await enrichOrganisationPending(organisation.id, 50);
    enriched += result.enriched;
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
  "escalation-check": runEscalationChecks,
  "deliver-webhooks": processPendingDeliveries,
  "deliver-automations": processPendingAutomationRuns,
  "enrich-cases": enrichPendingCases,
  "deliver-mobile-push": dispatchPendingMobilePushes,
  "prune-presence": pruneStalePresence,
  "scan-evidence": scanPendingEvidence,
  "purge-audit-events": purgeAuditData,
};
