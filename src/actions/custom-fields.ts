"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customFieldDefinitions } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId, slugify } from "@/lib/utils";
import {
  CUSTOM_FIELD_TYPES,
  setCustomFieldValue,
  type CustomFieldType,
} from "@/lib/custom-fields";

function parseOptions(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createFieldDefinition(formData: FormData) {
  const user = await requireRole(["admin"]);
  const label = String(formData.get("label") ?? "").trim();
  const typeRaw = String(formData.get("type") ?? "string");
  if (!label) throw new Error("Label is required");
  const type = (CUSTOM_FIELD_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as CustomFieldType)
    : "string";
  const key = (String(formData.get("key") ?? "").trim() || slugify(label)).replace(/-/g, "_");
  if (!key) throw new Error("Could not derive a key from the label");
  const options =
    type === "select" || type === "multi_select"
      ? parseOptions(formData.get("options"))
      : [];
  if ((type === "select" || type === "multi_select") && options.length === 0) {
    throw new Error("Select fields need at least one option");
  }
  const required = formData.get("required") === "on" || formData.get("required") === "true";

  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${customFieldDefinitions.orderIndex}), -1)::int` })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organisationId, user.organisationId),
        eq(customFieldDefinitions.entity, "case"),
      ),
    );

  await db.insert(customFieldDefinitions).values({
    id: newId("cfd"),
    organisationId: user.organisationId,
    entity: "case",
    key,
    label,
    type,
    options,
    required,
    orderIndex: (max ?? -1) + 1,
    isActive: true,
  });
  revalidatePath("/settings/fields");
}

export async function setFieldActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(customFieldDefinitions)
    .set({ isActive: active })
    .where(
      and(
        eq(customFieldDefinitions.id, id),
        eq(customFieldDefinitions.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/fields");
}

export async function reorderField(id: string, direction: "up" | "down") {
  const user = await requireRole(["admin"]);
  const defs = await db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organisationId, user.organisationId),
        eq(customFieldDefinitions.entity, "case"),
      ),
    )
    .orderBy(customFieldDefinitions.orderIndex);
  const idx = defs.findIndex((d) => d.id === id);
  if (idx === -1) return;
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= defs.length) return;
  const a = defs[idx];
  const b = defs[swapWith];
  await db
    .update(customFieldDefinitions)
    .set({ orderIndex: b.orderIndex })
    .where(eq(customFieldDefinitions.id, a.id));
  await db
    .update(customFieldDefinitions)
    .set({ orderIndex: a.orderIndex })
    .where(eq(customFieldDefinitions.id, b.id));
  revalidatePath("/settings/fields");
}

export async function deleteFieldDefinition(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.id, id),
        eq(customFieldDefinitions.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/fields");
}

export async function setCaseCustomField(
  caseId: string,
  fieldId: string,
  value: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  await setCustomFieldValue(user.organisationId, user.id, caseId, fieldId, value, {
    writeTimeline: true,
  });
  revalidatePath(`/cases/${caseId}`);
}
