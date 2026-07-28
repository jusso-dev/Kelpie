"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  createEvidenceItemCore,
  setEvidenceItemRemediationCore,
  setEvidenceItemVerdictCore,
} from "@/lib/investigations/evidence-items-core";
import type { EvidenceItem } from "@/db/schema";

export async function createEvidenceItem(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const type = String(formData.get("type") ?? "").trim();
  const value = String(formData.get("value") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!caseId || !type) throw new Error("caseId and type required");

  await createEvidenceItemCore({
    organisationId: user.organisationId,
    actorId: user.id,
    caseId,
    type,
    value: value || null,
    description: description || null,
    source: "analyst",
  });
  revalidatePath(`/cases/${caseId}/evidence-items`);
}

export async function updateEvidenceItemVerdict(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const evidenceItemId = String(formData.get("evidenceItemId") ?? "");
  const verdict = String(formData.get("verdict") ?? "") as EvidenceItem["verdict"];
  if (!caseId || !evidenceItemId || !verdict) throw new Error("Missing required fields");

  await setEvidenceItemVerdictCore({
    organisationId: user.organisationId,
    actorId: user.id,
    evidenceItemId,
    verdict,
  });
  revalidatePath(`/cases/${caseId}/evidence-items`);
}

export async function updateEvidenceItemRemediation(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const evidenceItemId = String(formData.get("evidenceItemId") ?? "");
  const remediationState = String(
    formData.get("remediationState") ?? "",
  ) as EvidenceItem["remediationState"];
  if (!caseId || !evidenceItemId || !remediationState) {
    throw new Error("Missing required fields");
  }

  await setEvidenceItemRemediationCore({
    organisationId: user.organisationId,
    actorId: user.id,
    evidenceItemId,
    remediationState,
  });
  revalidatePath(`/cases/${caseId}/evidence-items`);
}
