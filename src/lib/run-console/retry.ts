import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { caseSources, tiFeeds } from "@/db/schema";
import { retryResponseAction } from "@/lib/response-actions/core";
import { retryAutomationRun } from "@/lib/automations/core";
import { retryNotificationRun } from "./adapters/notifications";
import { pollFeed } from "@/lib/ti/core";
import { pollCaseSource } from "@/lib/case-sources/core";
import type { RunType } from "./types";

/**
 * Single dispatch point the run-console UI/API calls for "retry". Each
 * branch delegates to the domain module that already owns that run type's
 * invariants (lineage, approval revalidation, idempotency) rather than
 * duplicating any of that logic here.
 */
export async function retryRun(
  organisationId: string,
  actorId: string,
  runType: RunType,
  runId: string,
): Promise<void> {
  switch (runType) {
    case "response_action":
      await retryResponseAction(organisationId, actorId, runId);
      return;
    case "automation":
      await retryAutomationRun(organisationId, actorId, runId);
      return;
    case "notification":
      await retryNotificationRun(organisationId, runId);
      return;
    case "ti_feed_poll": {
      const feedId = runId.replace(/:latest$/, "");
      // pollFeed only takes a bare id, so tenant ownership must be verified
      // here first: an operator in one organisation must never be able to
      // trigger a poll of another organisation's feed.
      const [feed] = await db
        .select({ id: tiFeeds.id })
        .from(tiFeeds)
        .where(and(eq(tiFeeds.id, feedId), eq(tiFeeds.organisationId, organisationId)))
        .limit(1);
      if (!feed) throw new Error("TI feed not found");
      const result = await pollFeed(feedId);
      if (result.error) throw new Error(result.error);
      return;
    }
    case "case_source_poll": {
      const sourceId = runId.replace(/:latest$/, "");
      const [source] = await db
        .select({ id: caseSources.id })
        .from(caseSources)
        .where(and(eq(caseSources.id, sourceId), eq(caseSources.organisationId, organisationId)))
        .limit(1);
      if (!source) throw new Error("Case source not found");
      const result = await pollCaseSource(sourceId);
      if (result.error) throw new Error(result.error);
      return;
    }
    case "enrichment":
    case "report":
      throw new Error(`${runType} runs cannot be manually retried`);
    default:
      throw new Error(`Unsupported run type: ${runType satisfies never}`);
  }
}
