import { requestResponseActionCancel } from "@/lib/response-actions/core";
import { requestAutomationCancel } from "@/lib/automations/core";
import { cancelNotificationRun } from "./adapters/notifications";
import type { RunType } from "./types";

/**
 * Single dispatch point for "cancel". Every branch is best-effort: a run
 * still queued/awaiting-approval is cancelled outright, anything already
 * executing only gets a `cancel_requested` marker and completes with its
 * true outcome. Nothing here ever claims a provider effect was reversed.
 */
export async function cancelRun(
  organisationId: string,
  actorId: string,
  runType: RunType,
  runId: string,
): Promise<void> {
  switch (runType) {
    case "response_action":
      await requestResponseActionCancel(organisationId, actorId, runId);
      return;
    case "automation":
      await requestAutomationCancel(organisationId, actorId, runId);
      return;
    case "notification":
      await cancelNotificationRun(organisationId, runId);
      return;
    case "enrichment":
    case "report":
    case "ti_feed_poll":
    case "case_source_poll":
      throw new Error(`${runType} runs cannot be cancelled`);
    default:
      throw new Error(`Unsupported run type: ${runType satisfies never}`);
  }
}
