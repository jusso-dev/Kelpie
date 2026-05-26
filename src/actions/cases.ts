"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import {
  CASE_ENUMS,
  CaseVersionConflictError,
  closeCaseCore,
  createCaseCore,
  patchCaseCore,
  setCaseStatusCore,
  type CaseClassification,
  type CasePap,
  type CaseSeverity,
  type CaseStatus,
  type CaseTlp,
} from "@/lib/cases-core";

export type CaseFieldResult =
  | { ok: true }
  | { ok: false; conflict: Record<string, unknown> };
import { writeTimelineEvent } from "@/lib/timeline";
import { fireWebhook } from "@/lib/webhooks";
import { parseTagsInput } from "@/lib/tags";

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
  const result = await createCaseCore(user.organisationId, user.id, {
    title: String(formData.get("title") ?? ""),
    summary: String(formData.get("summary") ?? ""),
    severity: pickEnum(CASE_ENUMS.severity, formData.get("severity"), "medium"),
    tlp: pickEnum(CASE_ENUMS.tlp, formData.get("tlp"), "amber"),
    pap: pickEnum(CASE_ENUMS.pap, formData.get("pap"), "amber"),
    classification: pickEnum(
      CASE_ENUMS.classification,
      formData.get("classification"),
      "other",
    ),
    tags: parseTagsInput(String(formData.get("tags") ?? "")),
    dataClassificationTags: parseTagsInput(
      String(formData.get("dataClassificationTags") ?? ""),
    ),
  });
  await fireWebhook(user.organisationId, "case.created", {
    case_id: result.id,
    case_number: result.caseNumber,
    title: String(formData.get("title") ?? ""),
  });
  revalidatePath("/cases");
  redirect(`/cases/${result.id}`);
}

export async function updateCaseStatus(caseId: string, nextStatus: CaseStatus) {
  const user = await requireRole(["admin", "analyst"]);
  await setCaseStatusCore(user.organisationId, user.id, caseId, nextStatus);
  await fireWebhook(user.organisationId, "case.status_changed", {
    case_id: caseId,
    to: nextStatus,
  });
  if (nextStatus === "closed") {
    await fireWebhook(user.organisationId, "case.closed", { case_id: caseId });
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
}

export async function updateCaseField(
  caseId: string,
  field: "severity" | "assigneeId" | "tlp" | "pap" | "classification",
  value: string | null,
  expectedVersion?: number,
): Promise<CaseFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  const patch: Parameters<typeof patchCaseCore>[3] = {};
  if (field === "severity") {
    if (!(CASE_ENUMS.severity as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid severity");
    }
    patch.severity = value as CaseSeverity;
  } else if (field === "tlp") {
    if (!(CASE_ENUMS.tlp as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid TLP");
    }
    patch.tlp = value as CaseTlp;
  } else if (field === "pap") {
    if (!(CASE_ENUMS.pap as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid PAP");
    }
    patch.pap = value as CasePap;
  } else if (field === "classification") {
    if (!(CASE_ENUMS.classification as readonly string[]).includes(value ?? "")) {
      throw new Error("Invalid classification");
    }
    patch.classification = value as CaseClassification;
  } else if (field === "assigneeId") {
    patch.assigneeId = value;
  }
  try {
    await patchCaseCore(user.organisationId, user.id, caseId, patch, expectedVersion);
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
  revalidatePath(`/cases/${caseId}`);
  return { ok: true };
}

export async function updateCaseTags(
  caseId: string,
  field: "tags" | "dataClassificationTags",
  values: string[],
  expectedVersion?: number,
): Promise<CaseFieldResult> {
  const user = await requireRole(["admin", "analyst"]);
  const patch: Parameters<typeof patchCaseCore>[3] = {};
  patch[field] = values;
  try {
    await patchCaseCore(user.organisationId, user.id, caseId, patch, expectedVersion);
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return { ok: false, conflict: e.current };
    }
    throw e;
  }
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
  return { ok: true };
}

export async function closeCase(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const summary = String(formData.get("summary") ?? "");
  if (!caseId) throw new Error("caseId required");
  await closeCaseCore(user.organisationId, user.id, caseId, reason, summary);
  await fireWebhook(user.organisationId, "case.status_changed", {
    case_id: caseId,
    to: "closed",
    reason,
  });
  await fireWebhook(user.organisationId, "case.closed", {
    case_id: caseId,
    reason,
  });
  revalidatePath(`/cases/${caseId}`);
  revalidatePath("/cases");
}

export async function updateMitreTechniques(
  caseId: string,
  techniqueIds: string[],
) {
  const user = await requireRole(["admin", "analyst"]);
  const [existing] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, user.organisationId)))
    .limit(1);
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
