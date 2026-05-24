"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { requireRole, requireUser } from "@/lib/session";
import { newId } from "@/lib/utils";
import { nextCaseNumber } from "@/lib/case-number";
import { writeTimelineEvent } from "@/lib/timeline";

const STATUS_VALUES = [
  "open",
  "in_progress",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;

const SEVERITY_VALUES = ["low", "medium", "high", "critical"] as const;
const TLP_VALUES = ["clear", "green", "amber", "amber_strict", "red"] as const;
const PAP_VALUES = ["clear", "green", "amber", "red"] as const;
const CLASSIFICATION_VALUES = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
] as const;

type Status = (typeof STATUS_VALUES)[number];
type Severity = (typeof SEVERITY_VALUES)[number];
type Tlp = (typeof TLP_VALUES)[number];
type Pap = (typeof PAP_VALUES)[number];
type Classification = (typeof CLASSIFICATION_VALUES)[number];

function pickEnum<T extends readonly string[]>(
  values: T,
  raw: FormDataEntryValue | null,
  fallback: T[number],
): T[number] {
  const v = typeof raw === "string" ? raw : "";
  return (values as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

export async function createCase(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Title is required");
  const summary = String(formData.get("summary") ?? "").trim();
  const severity = pickEnum(SEVERITY_VALUES, formData.get("severity"), "medium");
  const tlp = pickEnum(TLP_VALUES, formData.get("tlp"), "amber");
  const pap = pickEnum(PAP_VALUES, formData.get("pap"), "amber");
  const classification = pickEnum(
    CLASSIFICATION_VALUES,
    formData.get("classification"),
    "other",
  );

  const id = newId("case");
  const caseNumber = await nextCaseNumber(user.organisationId);
  await db.insert(cases).values({
    id,
    organisationId: user.organisationId,
    caseNumber,
    title,
    summary,
    severity,
    tlp,
    pap,
    classification,
    reporterId: user.id,
    assigneeId: user.id,
  });
  await writeTimelineEvent({
    caseId: id,
    actorId: user.id,
    eventType: "case_created",
    payload: { title, severity, classification },
  });
  revalidatePath("/cases");
  redirect(`/cases/${id}`);
}

async function loadCaseInOrg(id: string, organisationId: string) {
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function updateCaseStatus(caseId: string, nextStatus: Status) {
  const user = await requireRole(["admin", "analyst"]);
  const existing = await loadCaseInOrg(caseId, user.organisationId);
  if (!existing) throw new Error("Case not found");
  if (existing.status === nextStatus) return;

  const patch: Partial<typeof cases.$inferInsert> = { status: nextStatus };
  // Mark lifecycle milestones the first time we cross them.
  if (nextStatus === "in_progress" && !existing.acknowledgedAt) {
    patch.acknowledgedAt = new Date();
  }
  if (nextStatus === "contained" && !existing.containedAt) {
    patch.containedAt = new Date();
  }
  if (
    (nextStatus === "recovered" || nextStatus === "closed") &&
    !existing.resolvedAt
  ) {
    patch.resolvedAt = new Date();
  }
  await db.update(cases).set(patch).where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "status_change",
    payload: { from: existing.status, to: nextStatus },
  });
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
}

export async function updateCaseField(
  caseId: string,
  field: "severity" | "assigneeId" | "tlp" | "pap" | "classification",
  value: string | null,
) {
  const user = await requireRole(["admin", "analyst"]);
  const existing = await loadCaseInOrg(caseId, user.organisationId);
  if (!existing) throw new Error("Case not found");

  let patch: Partial<typeof cases.$inferInsert> = {};
  let eventType: "severity_change" | "assignment_change" | "custom" = "custom";
  let payload: Record<string, unknown> = { field };

  if (field === "severity") {
    if (!(SEVERITY_VALUES as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid severity");
    }
    patch.severity = value as Severity;
    eventType = "severity_change";
    payload = { from: existing.severity, to: value };
  } else if (field === "assigneeId") {
    patch.assigneeId = value;
    eventType = "assignment_change";
    payload = { from: existing.assigneeId, to: value };
  } else if (field === "tlp") {
    if (!(TLP_VALUES as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid TLP");
    }
    patch.tlp = value as Tlp;
    payload = { field: "tlp", from: existing.tlp, to: value };
  } else if (field === "pap") {
    if (!(PAP_VALUES as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid PAP");
    }
    patch.pap = value as Pap;
    payload = { field: "pap", from: existing.pap, to: value };
  } else if (field === "classification") {
    if (!(CLASSIFICATION_VALUES as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid classification");
    }
    patch.classification = value as Classification;
    payload = { field: "classification", from: existing.classification, to: value };
  }
  await db.update(cases).set(patch).where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType,
    payload,
  });
  revalidatePath(`/cases/${caseId}`);
}

export async function closeCase(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const summary = String(formData.get("summary") ?? "").trim();
  if (!caseId) throw new Error("caseId required");
  if (!reason) throw new Error("Closure reason is required");
  if (!summary) throw new Error("Closure summary is required");

  const existing = await loadCaseInOrg(caseId, user.organisationId);
  if (!existing) throw new Error("Case not found");

  await db
    .update(cases)
    .set({
      status: "closed",
      closedAt: new Date(),
      resolvedAt: existing.resolvedAt ?? new Date(),
      closureReason: reason,
      closureSummary: summary,
    })
    .where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "status_change",
    payload: { from: existing.status, to: "closed", reason },
  });
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
}

export async function updateMitreTechniques(
  caseId: string,
  techniqueIds: string[],
) {
  const user = await requireRole(["admin", "analyst"]);
  const existing = await loadCaseInOrg(caseId, user.organisationId);
  if (!existing) throw new Error("Case not found");
  await db
    .update(cases)
    .set({ mitreTechniques: techniqueIds })
    .where(eq(cases.id, caseId));
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "custom",
    payload: { field: "mitre_techniques", value: techniqueIds },
  });
  revalidatePath(`/cases/${caseId}`);
}
