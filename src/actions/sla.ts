"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { slaPolicies, organisations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { DEFAULT_SLA_POLICIES } from "@/lib/sla";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

function parseMinutes(raw: FormDataEntryValue | null, field: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${field}`);
  return Math.round(n);
}

export async function seedDefaultSlaPolicies(organisationId: string) {
  for (const p of DEFAULT_SLA_POLICIES) {
    await db
      .insert(slaPolicies)
      .values({
        id: newId("sla"),
        organisationId,
        name: p.name,
        severity: p.severity,
        timeToAcknowledgeMinutes: p.timeToAcknowledgeMinutes,
        timeToContainMinutes: p.timeToContainMinutes,
        timeToResolveMinutes: p.timeToResolveMinutes,
      })
      .onConflictDoNothing({
        target: [slaPolicies.organisationId, slaPolicies.severity],
      });
  }
}

export async function createSlaPolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  const severityRaw = String(formData.get("severity") ?? "");
  if (!name) throw new Error("Name required");
  if (!(SEVERITIES as readonly string[]).includes(severityRaw)) {
    throw new Error("Invalid severity");
  }
  await db.insert(slaPolicies).values({
    id: newId("sla"),
    organisationId: user.organisationId,
    name,
    severity: severityRaw as (typeof SEVERITIES)[number],
    timeToAcknowledgeMinutes: parseMinutes(formData.get("ack"), "acknowledge"),
    timeToContainMinutes: parseMinutes(formData.get("contain"), "contain"),
    timeToResolveMinutes: parseMinutes(formData.get("resolve"), "resolve"),
  });
  revalidatePath("/settings");
}

export async function updateSlaPolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name required");
  await db
    .update(slaPolicies)
    .set({
      name,
      timeToAcknowledgeMinutes: parseMinutes(formData.get("ack"), "acknowledge"),
      timeToContainMinutes: parseMinutes(formData.get("contain"), "contain"),
      timeToResolveMinutes: parseMinutes(formData.get("resolve"), "resolve"),
    })
    .where(
      and(
        eq(slaPolicies.id, id),
        eq(slaPolicies.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings");
}

export async function deleteSlaPolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("id required");
  await db
    .delete(slaPolicies)
    .where(
      and(
        eq(slaPolicies.id, id),
        eq(slaPolicies.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings");
}
