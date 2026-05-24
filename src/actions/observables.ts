"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cases, observables } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { enrichObservable } from "@/lib/enrichment";

const TYPES = [
  "ip",
  "domain",
  "url",
  "file_hash",
  "email",
  "hostname",
  "username",
  "registry_key",
  "other",
] as const;

const TLPS = ["clear", "green", "amber", "amber_strict", "red"] as const;

export async function addObservable(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const typeRaw = String(formData.get("type") ?? "other");
  const value = String(formData.get("value") ?? "").trim();
  const tlpRaw = String(formData.get("tlp") ?? "amber");
  const description = String(formData.get("description") ?? "").trim();
  const isIoc = formData.get("isIoc") === "on";
  if (!caseId || !value) throw new Error("caseId and value required");

  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, user.organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");

  const type = (TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as (typeof TYPES)[number])
    : "other";
  const tlp = (TLPS as readonly string[]).includes(tlpRaw)
    ? (tlpRaw as (typeof TLPS)[number])
    : "amber";

  const id = newId("obs");
  await db.insert(observables).values({
    id,
    caseId,
    type,
    value,
    tlp,
    isIoc,
    description: description || null,
    createdBy: user.id,
  });
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "observable_added",
    payload: { observable_id: id, type, value, is_ioc: isIoc },
  });
  void enrichObservable(id, type, value).catch(() => {});
  revalidatePath(`/cases/${caseId}/observables`);
  revalidatePath(`/observables`);
}
