"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  setAnalystOverridesCore,
  resolveMatchReviewCore,
  upsertContextFromProvider,
} from "@/lib/asset-context/context-core";
import { runContextImport } from "@/lib/asset-context/import-core";
import {
  recalculateCasePriorityCore,
  setPriorityOverrideCore,
} from "@/lib/asset-context/priority-core";
import { updatePriorityScoringSettings } from "@/lib/asset-context/settings";
import {
  AssetContextError,
  type CriticalityLevel,
  type ExposureLevel,
  type PrivilegeLevel,
  type PriorityWeights,
  type RecoveryPriority,
  type StaleContextPolicy,
} from "@/lib/asset-context/types";

function errMsg(err: unknown): string {
  if (err instanceof AssetContextError) return err.message;
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

export async function importContextCsvAction(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const csvText = String(formData.get("csvText") ?? "");
  const dryRun = String(formData.get("dryRun") ?? "true") !== "false";
  try {
    const result = await runContextImport({
      organisationId: user.organisationId,
      source: "csv",
      actorId: user.id,
      dryRun,
      csvText,
    });
    revalidatePath("/settings/asset-context");
    revalidatePath("/asset-context");
    return {
      ok: true as const,
      run: result.run,
      errors: result.errors,
      validRowCount: result.rows.length,
    };
  } catch (err) {
    return { ok: false as const, error: errMsg(err) };
  }
}

export async function setContextOverrideAction(
  contextId: string,
  overrides: {
    criticalityOverride?: CriticalityLevel | null;
    privilegeLevelOverride?: PrivilegeLevel | null;
    exposureOverride?: ExposureLevel | null;
    isCrownJewelOverride?: boolean | null;
    recoveryPriorityOverride?: RecoveryPriority | null;
  },
) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const context = await setAnalystOverridesCore(
      user.organisationId,
      contextId,
      overrides,
      user.id,
    );
    revalidatePath("/asset-context");
    revalidatePath("/settings/asset-context");
    return { ok: true as const, context };
  } catch (err) {
    return { ok: false as const, error: errMsg(err) };
  }
}

export async function resolveMatchReviewAction(
  reviewId: string,
  decision: { action: "link"; entityId: string } | { action: "dismiss" },
) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const review = await resolveMatchReviewCore(
      user.organisationId,
      reviewId,
      decision,
      user.id,
    );
    revalidatePath("/settings/asset-context");
    revalidatePath("/asset-context");
    return { ok: true as const, review };
  } catch (err) {
    return { ok: false as const, error: errMsg(err) };
  }
}

export async function savePrioritySettingsAction(input: {
  enabled?: boolean;
  weights?: Partial<PriorityWeights>;
  staleContextPolicy?: StaleContextPolicy;
  staleAfterHours?: number;
}) {
  const user = await requireRole(["admin"]);
  try {
    const settings = await updatePriorityScoringSettings(
      user.organisationId,
      input,
    );
    revalidatePath("/settings/asset-context");
    return { ok: true as const, settings };
  } catch (err) {
    return { ok: false as const, error: errMsg(err) };
  }
}

export async function recalculateCasePriorityAction(caseId: string) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const priority = await recalculateCasePriorityCore(
      user.organisationId,
      caseId,
    );
    if (!priority) return { ok: false as const, error: "Case not found" };
    revalidatePath(`/cases/${caseId}`);
    return { ok: true as const, priority };
  } catch (err) {
    return { ok: false as const, error: errMsg(err) };
  }
}

export async function setCasePriorityOverrideAction(
  caseId: string,
  score: number | null,
  reason?: string | null,
) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const priority = await setPriorityOverrideCore(
      user.organisationId,
      caseId,
      { score, reason },
      user.id,
    );
    revalidatePath(`/cases/${caseId}`);
    return { ok: true as const, priority };
  } catch (err) {
    return { ok: false as const, error: errMsg(err) };
  }
}

export async function createManualContextAction(input: {
  kind: "asset" | "identity" | "application" | "business_service";
  displayName: string;
  primaryIdentifierKind: string;
  primaryIdentifierValue: string;
  criticality?: CriticalityLevel;
  privilegeLevel?: PrivilegeLevel;
  isCrownJewel?: boolean;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await upsertContextFromProvider({
      organisationId: user.organisationId,
      kind: input.kind,
      displayName: input.displayName,
      primaryIdentifierKind: input.primaryIdentifierKind as
        | "email"
        | "hostname"
        | "device_id"
        | "upn"
        | "other",
      primaryIdentifierValue: input.primaryIdentifierValue,
      criticality: input.criticality,
      privilegeLevel: input.privilegeLevel,
      isCrownJewel: input.isCrownJewel,
      providerSource: "manual",
      actorId: user.id,
      markSyncOk: true,
    });
    revalidatePath("/asset-context");
    return {
      ok: true as const,
      context: result.context,
      created: result.created,
      matchReviewId: result.matchReviewId,
    };
  } catch (err) {
    return { ok: false as const, error: errMsg(err) };
  }
}
