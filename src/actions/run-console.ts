"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { retryRun } from "@/lib/run-console/retry";
import { cancelRun } from "@/lib/run-console/cancel";
import { setKillSwitch, type KillSwitchScope } from "@/lib/run-console/kill-switch";
import { canControlRuns, canManageKillSwitches } from "@/lib/run-console/permissions";
import type { RunType } from "@/lib/run-console/types";
import { RUN_TYPES } from "@/lib/run-console/types";

function parseRunType(value: FormDataEntryValue | null): RunType {
  const raw = String(value ?? "");
  if (!(RUN_TYPES as readonly string[]).includes(raw)) {
    throw new Error("Unknown run type");
  }
  return raw as RunType;
}

export async function retryRunAction(formData: FormData): Promise<void> {
  // Retry/cancel require the same roles as requesting a response action;
  // observation (the list/detail pages) is open to read_only as well.
  const user = await requireRole(["admin", "analyst"]);
  if (!canControlRuns(user)) throw new Error("Forbidden");
  const runType = parseRunType(formData.get("runType"));
  const runId = String(formData.get("runId") ?? "");
  if (!runId) throw new Error("Missing run id");
  await retryRun(user.organisationId, user.id, runType, runId);
  revalidatePath("/settings/run-console");
}

export async function cancelRunAction(formData: FormData): Promise<void> {
  const user = await requireRole(["admin", "analyst"]);
  if (!canControlRuns(user)) throw new Error("Forbidden");
  const runType = parseRunType(formData.get("runType"));
  const runId = String(formData.get("runId") ?? "");
  if (!runId) throw new Error("Missing run id");
  await cancelRun(user.organisationId, user.id, runType, runId);
  revalidatePath("/settings/run-console");
}

export async function setKillSwitchAction(formData: FormData): Promise<void> {
  const user = await requireRole(["admin"]);
  if (!canManageKillSwitches(user)) throw new Error("Forbidden");
  const scope = String(formData.get("scope") ?? "") as KillSwitchScope;
  if (scope !== "organisation" && scope !== "provider" && scope !== "action") {
    throw new Error("Unknown kill switch scope");
  }
  const scopeKey = String(formData.get("scopeKey") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  const reason = String(formData.get("reason") ?? "");
  await setKillSwitch({
    organisationId: user.organisationId,
    scope,
    scopeKey,
    enabled,
    reason,
    actorId: user.id,
  });
  revalidatePath("/settings/run-console");
}
