"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { responseActions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { getActionHandler, listActionHandlers } from "@/lib/response-actions/registry";
import {
  approveResponseAction,
  cancelResponseAction,
  rejectResponseAction,
  runResponseAction,
} from "@/lib/response-actions/core";
import { assertSafeOutboundUrl } from "@/lib/outbound-request";

function collectConfig(kind: string, formData: FormData): Record<string, string> {
  const handler = getActionHandler(kind);
  if (!handler) throw new Error("Unknown action kind");
  const config: Record<string, string> = {};
  for (const field of handler.configFields) {
    const raw = formData.get(`config.${field.key}`);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value) {
      throw new Error(`${field.label} is required`);
    }
    if (value) config[field.key] = value;
  }
  return config;
}

async function validateActionUrls(config: Record<string, string>) {
  if (config.base_url) await assertSafeOutboundUrl(config.base_url);
}

export async function createResponseAction(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!name) throw new Error("Name is required");
  if (!getActionHandler(kind)) throw new Error("Unknown action kind");
  const config = collectConfig(kind, formData);
  await validateActionUrls(config);
  await db.insert(responseActions).values({
    id: newId("ra"),
    organisationId: user.organisationId,
    name,
    kind,
    config,
    isActive: true,
    createdBy: user.id,
  });
  revalidatePath("/settings/integrations");
}

export async function updateResponseActionConfig(id: string, formData: FormData) {
  const user = await requireRole(["admin"]);
  const [existing] = await db
    .select()
    .from(responseActions)
    .where(
      and(
        eq(responseActions.id, id),
        eq(responseActions.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Action not found");
  const name = String(formData.get("name") ?? existing.name).trim();
  const config = collectConfig(existing.kind, formData);
  await validateActionUrls(config);
  await db
    .update(responseActions)
    .set({ name, config })
    .where(eq(responseActions.id, id));
  revalidatePath("/settings/integrations");
}

export async function setResponseActionActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(responseActions)
    .set({ isActive: active })
    .where(
      and(
        eq(responseActions.id, id),
        eq(responseActions.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function deleteResponseAction(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(responseActions)
    .where(
      and(
        eq(responseActions.id, id),
        eq(responseActions.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function runCaseAction(formData: FormData): Promise<{
  ok: boolean;
  summary: string;
  status: "awaiting_approval";
}> {
  const user = await requireRole(["admin", "analyst"]);
  const actionId = String(formData.get("actionId") ?? "");
  const caseId = String(formData.get("caseId") ?? "");
  if (!actionId || !caseId) throw new Error("Missing action or case");
  const input: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("input.") && typeof value === "string") {
      input[key.slice("input.".length)] = value;
    }
  }
  const result = await runResponseAction(
    user.organisationId,
    user.id,
    actionId,
    caseId,
    input,
  );
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/timeline`);
  return { ok: result.ok, summary: result.summary, status: result.status };
}

export async function approveCaseAction(runId: string): Promise<{
  ok: boolean;
  summary: string;
}> {
  const user = await requireRole(["admin"]);
  if (!runId) throw new Error("Missing response action request");
  const result = await approveResponseAction(user.organisationId, user.id, runId);
  revalidatePath("/cases");
  return result;
}

export async function rejectCaseAction(runId: string, reason?: string) {
  const user = await requireRole(["admin"]);
  if (!runId) throw new Error("Missing response action request");
  await rejectResponseAction(user.organisationId, user.id, runId, reason);
  revalidatePath("/cases");
}

export async function cancelCaseAction(runId: string) {
  const user = await requireRole(["admin", "analyst"]);
  if (!runId) throw new Error("Missing response action request");
  await cancelResponseAction(user.organisationId, user.id, runId);
  revalidatePath("/cases");
}

export async function availableActionKinds() {
  return listActionHandlers().map((h) => ({
    kind: h.kind,
    label: h.label,
    description: h.description,
    approvalRequired: h.approvalRequired,
    configFields: h.configFields,
  }));
}
