"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { caseSources } from "@/db/schema";
import { pollCaseSource } from "@/lib/case-sources/core";
import {
  validateSentinelConfig,
  type SentinelConfig,
} from "@/lib/case-sources/sentinel";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";

function sentinelConfig(formData: FormData): SentinelConfig {
  const value = (key: string) => String(formData.get(key) ?? "").trim();
  const config: SentinelConfig = {
    tenant_id: value("tenant_id"),
    client_id: value("client_id"),
    client_secret: value("client_secret"),
    subscription_id: value("subscription_id"),
    resource_group: value("resource_group"),
    workspace_name: value("workspace_name"),
    include_closed: formData.get("include_closed") === "on" ? "true" : "false",
  };
  validateSentinelConfig(config);
  return config;
}

export async function createCaseSource(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const interval = Number(formData.get("poll_interval_minutes") ?? 5);
  if (!Number.isInteger(interval) || interval < 1 || interval > 10080) {
    throw new Error("Poll interval must be between 1 minute and 7 days.");
  }
  await db.insert(caseSources).values({
    id: newId("src"),
    organisationId: user.organisationId,
    name,
    kind: "microsoft_sentinel",
    config: sentinelConfig(formData),
    pollIntervalMinutes: interval,
    createdBy: user.id,
  });
  revalidatePath("/settings/integrations");
}

export async function setCaseSourceActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(caseSources)
    .set({ isActive: active, lastError: active ? null : undefined })
    .where(
      and(
        eq(caseSources.id, id),
        eq(caseSources.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function updateCaseSourceSchedule(
  id: string,
  intervalMinutes: number,
  active: boolean,
) {
  const user = await requireRole(["admin"]);
  if (
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 1 ||
    intervalMinutes > 10080
  ) {
    throw new Error("Choose an interval between 1 minute and 7 days.");
  }
  await db
    .update(caseSources)
    .set({
      pollIntervalMinutes: intervalMinutes,
      isActive: active,
      lastError: active ? null : undefined,
    })
    .where(
      and(
        eq(caseSources.id, id),
        eq(caseSources.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function pollCaseSourceNow(id: string) {
  const user = await requireRole(["admin"]);
  const [source] = await db
    .select({ id: caseSources.id })
    .from(caseSources)
    .where(
      and(
        eq(caseSources.id, id),
        eq(caseSources.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!source) throw new Error("Case source not found");
  const result = await pollCaseSource(id);
  revalidatePath("/settings/integrations");
  revalidatePath("/cases");
  if (result.error) throw new Error(result.error);
  return result;
}

export async function deleteCaseSource(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(caseSources)
    .where(
      and(
        eq(caseSources.id, id),
        eq(caseSources.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}
