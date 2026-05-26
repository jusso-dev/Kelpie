"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { siemConnectors } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { getConnector, listConnectors } from "@/lib/connectors/registry";
import { pollConnector } from "@/lib/connectors/core";
import type { FieldMapping } from "@/lib/connectors/types";

function collectConfig(kind: string, formData: FormData): Record<string, string> {
  const handler = getConnector(kind);
  if (!handler) throw new Error("Unknown connector kind");
  const config: Record<string, string> = {};
  for (const field of handler.configFields) {
    const raw = formData.get(`config.${field.key}`);
    const value = typeof raw === "string" ? raw.trim() : "";
    if (field.required && !value) throw new Error(`${field.label} is required`);
    if (value) config[field.key] = value;
  }
  return config;
}

function parseMapping(raw: FormDataEntryValue | null): FieldMapping | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as FieldMapping;
    if (!parsed.title || !parsed.externalRef) {
      throw new Error("Mapping needs at least a title and externalRef path");
    }
    return parsed;
  } catch (e) {
    throw new Error(`Invalid mapping JSON: ${(e as Error).message}`);
  }
}

export async function createConnector(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const kind = String(formData.get("kind") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const handler = getConnector(kind);
  if (!handler) throw new Error("Unknown connector kind");
  const config = collectConfig(kind, formData);
  const mapping = parseMapping(formData.get("mapping")) ?? handler.defaultMapping;
  await db.insert(siemConnectors).values({
    id: newId("siem"),
    organisationId: user.organisationId,
    kind,
    name,
    config,
    mapping,
    isActive: true,
    createdBy: user.id,
  });
  revalidatePath("/settings/integrations");
}

export async function updateConnector(id: string, formData: FormData) {
  const user = await requireRole(["admin"]);
  const [existing] = await db
    .select()
    .from(siemConnectors)
    .where(
      and(
        eq(siemConnectors.id, id),
        eq(siemConnectors.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Connector not found");
  const name = String(formData.get("name") ?? existing.name).trim();
  const config = collectConfig(existing.kind, formData);
  const mapping =
    parseMapping(formData.get("mapping")) ??
    (existing.mapping as FieldMapping);
  await db
    .update(siemConnectors)
    .set({ name, config, mapping })
    .where(eq(siemConnectors.id, id));
  revalidatePath("/settings/integrations");
}

export async function updateConnectorMapping(id: string, rawMapping: string) {
  const user = await requireRole(["admin"]);
  const mapping = parseMapping(rawMapping);
  if (!mapping) throw new Error("Mapping JSON is required");
  await db
    .update(siemConnectors)
    .set({ mapping })
    .where(
      and(
        eq(siemConnectors.id, id),
        eq(siemConnectors.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function setConnectorActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(siemConnectors)
    .set({ isActive: active })
    .where(
      and(
        eq(siemConnectors.id, id),
        eq(siemConnectors.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function clearConnectorError(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .update(siemConnectors)
    .set({ lastError: null })
    .where(
      and(
        eq(siemConnectors.id, id),
        eq(siemConnectors.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function deleteConnector(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(siemConnectors)
    .where(
      and(
        eq(siemConnectors.id, id),
        eq(siemConnectors.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
}

export async function pollConnectorNow(id: string): Promise<{
  produced: number;
  error: string | null;
}> {
  const user = await requireRole(["admin"]);
  const [existing] = await db
    .select({ id: siemConnectors.id })
    .from(siemConnectors)
    .where(
      and(
        eq(siemConnectors.id, id),
        eq(siemConnectors.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Connector not found");
  const result = await pollConnector(id);
  revalidatePath("/settings/integrations");
  return result;
}

export async function connectorKinds() {
  return listConnectors().map((c) => ({
    kind: c.kind,
    label: c.label,
    description: c.description,
    configFields: c.configFields,
    defaultMapping: c.defaultMapping,
  }));
}
