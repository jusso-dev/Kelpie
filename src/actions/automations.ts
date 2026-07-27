"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { automationRules } from "@/db/schema";
import { assertSafeOutboundUrl } from "@/lib/outbound-request";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import {
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_TRIGGERS,
  type AutomationCondition,
  type AutomationTrigger,
} from "@/lib/automations/types";

const PROFILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,99}$/;

export async function createAutomationRule(formData: FormData) {
  const user = await requireRole(["admin"]);
  const value = (key: string) => String(formData.get(key) ?? "").trim();
  const name = value("name");
  const triggerEvent = value("trigger_event");
  const destinationUrl = value("destination_url");
  const secret = value("secret");
  const keyId = value("key_id");
  const targetProfile = value("target_profile");
  if (!name || name.length > 120) throw new Error("Name is required");
  if (!AUTOMATION_TRIGGERS.includes(triggerEvent as AutomationTrigger)) {
    throw new Error("Unsupported automation trigger");
  }
  await assertSafeOutboundUrl(destinationUrl);
  if (secret.length < 32) {
    throw new Error("Signing secret must be at least 32 characters");
  }
  if (!PROFILE_PATTERN.test(keyId)) throw new Error("Key ID is invalid");
  if (!PROFILE_PATTERN.test(targetProfile)) {
    throw new Error("Target profile is invalid");
  }

  const field = value("condition_field");
  const conditionValue = value("condition_value");
  const operator = value("condition_operator");
  const conditions: AutomationCondition[] = [];
  if (field || conditionValue) {
    if (
      !AUTOMATION_CONDITION_FIELDS.includes(
        field as (typeof AUTOMATION_CONDITION_FIELDS)[number],
      ) ||
      !["equals", "not_equals", "contains"].includes(operator) ||
      !conditionValue
    ) {
      throw new Error("Automation condition is incomplete");
    }
    conditions.push({
      field: field as AutomationCondition["field"],
      operator: operator as AutomationCondition["operator"],
      value: conditionValue.slice(0, 200),
    });
  }

  await db.insert(automationRules).values({
    id: newId("aut"),
    organisationId: user.organisationId,
    name,
    triggerEvent,
    conditions,
    destinationUrl,
    secret,
    keyId,
    targetProfile,
    isActive: false,
    createdBy: user.id,
  });
  revalidatePath("/settings/automations");
}

export async function setAutomationRuleActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(automationRules)
    .set({ isActive: active, updatedAt: new Date() })
    .where(
      and(
        eq(automationRules.id, id),
        eq(automationRules.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/automations");
}

export async function deleteAutomationRule(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(automationRules)
    .where(
      and(
        eq(automationRules.id, id),
        eq(automationRules.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/automations");
}
