"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  createPolicyCore,
  disablePolicyCore,
  enablePolicyCore,
  updatePolicyCore,
  ESCALATION_TRIGGER_TYPES,
  type EscalationTriggerType,
} from "@/lib/escalation-core";

// Escalation policies are sensitive (they notify/reassign/raise severity on
// cases automatically) — admin-only, unlike case-level actions which also
// allow analysts.
const SETTINGS_PATH = "/settings/escalation-policies";

function pickTriggerType(raw: FormDataEntryValue | null): EscalationTriggerType {
  const v = typeof raw === "string" ? raw : "";
  return (ESCALATION_TRIGGER_TYPES as readonly string[]).includes(v)
    ? (v as EscalationTriggerType)
    : "age_minutes";
}

function parseOptionalNumber(raw: FormDataEntryValue | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Builds a `triggerConfig` object from the flat v1 settings form. Only the
 * fields relevant to the submitted `triggerType` are included; validation
 * (and rejection of anything else) happens in `escalation-core.ts`.
 */
function buildTriggerConfig(
  triggerType: EscalationTriggerType,
  formData: FormData,
): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  const cooldownMinutes = parseOptionalNumber(formData.get("cooldownMinutes"));
  if (cooldownMinutes !== undefined) config.cooldownMinutes = cooldownMinutes;

  if (triggerType === "age_minutes") {
    const ageMinutes = parseOptionalNumber(formData.get("ageMinutes"));
    if (ageMinutes !== undefined) config.ageMinutes = ageMinutes;
    return config;
  }
  if (triggerType === "sla_warning" || triggerType === "sla_breached") {
    const gate = String(formData.get("gate") ?? "");
    if (gate) config.gate = gate;
    return config;
  }
  // stale_status
  const status = String(formData.get("status") ?? "");
  if (status) config.status = status;
  const staleAfterMinutes = parseOptionalNumber(formData.get("staleAfterMinutes"));
  if (staleAfterMinutes !== undefined) config.staleAfterMinutes = staleAfterMinutes;
  return config;
}

/** Builds a single-element `actions` array from the flat v1 settings form. */
function buildActions(formData: FormData): Array<Record<string, unknown>> {
  const actionType = String(formData.get("actionType") ?? "notify");
  if (actionType === "reassign") {
    const assigneeId = String(formData.get("assigneeId") ?? "").trim();
    return [{ type: "reassign", assigneeId }];
  }
  if (actionType === "raise_severity") {
    return [{ type: "raise_severity" }];
  }
  const channel = String(formData.get("channel") ?? "both");
  return [{ type: "notify", channel }];
}

export async function createPolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const triggerType = pickTriggerType(formData.get("triggerType"));
  await createPolicyCore(user.organisationId, user.id, {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "") || undefined,
    triggerType,
    triggerConfig: buildTriggerConfig(triggerType, formData),
    actions: buildActions(formData),
  });
  revalidatePath(SETTINGS_PATH);
}

export async function updatePolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const id = String(formData.get("id") ?? "");
  const version = Number(formData.get("version"));
  if (!id || !Number.isFinite(version)) {
    throw new Error("id and version are required");
  }
  const triggerType = pickTriggerType(formData.get("triggerType"));
  const name = String(formData.get("name") ?? "").trim();
  await updatePolicyCore(
    user.organisationId,
    user.id,
    id,
    {
      name: name || undefined,
      description: formData.has("description")
        ? String(formData.get("description") ?? "")
        : undefined,
      triggerConfig: buildTriggerConfig(triggerType, formData),
      actions: buildActions(formData),
    },
    version,
  );
  revalidatePath(SETTINGS_PATH);
}

export async function disablePolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const id = String(formData.get("id") ?? "");
  const version = Number(formData.get("version"));
  if (!id || !Number.isFinite(version)) {
    throw new Error("id and version are required");
  }
  await disablePolicyCore(user.organisationId, user.id, id, version);
  revalidatePath(SETTINGS_PATH);
}

export async function enablePolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const id = String(formData.get("id") ?? "");
  const version = Number(formData.get("version"));
  if (!id || !Number.isFinite(version)) {
    throw new Error("id and version are required");
  }
  await enablePolicyCore(user.organisationId, user.id, id, version);
  revalidatePath(SETTINGS_PATH);
}
