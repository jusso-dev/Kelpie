"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import type { Attachment } from "@/db/schema";
import {
  uploadEvidenceCore,
  overrideQuarantineCore,
  renameEvidenceCore,
  deleteEvidenceCore,
  setLabelsCore,
  setRelevanceCore,
  setExaminerNotesCore,
  setAcquisitionCore,
} from "@/lib/evidence/core";
import {
  applyLegalHoldCore,
  releaseLegalHoldCore,
} from "@/lib/evidence/legal-hold";
import {
  createCollectionCore,
  addEvidenceToCollectionCore,
  removeEvidenceFromCollectionCore,
} from "@/lib/evidence/collections";
import { parseTagsInput } from "@/lib/tags";

function revalidateEvidence(caseId: string, evidenceId?: string) {
  revalidatePath(`/cases/${caseId}/attachments`);
  if (evidenceId) revalidatePath(`/cases/${caseId}/attachments/${evidenceId}`);
}

export async function uploadAttachment(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const file = formData.get("file");
  if (!caseId || !(file instanceof File)) {
    throw new Error("caseId and file are required");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await uploadEvidenceCore({
    organisationId: user.organisationId,
    caseId,
    actorId: user.id,
    buffer,
    filename: file.name,
    declaredContentType: file.type || null,
  });
  revalidateEvidence(caseId);
}

export async function overrideEvidenceQuarantine(
  caseId: string,
  evidenceId: string,
  reason: string,
) {
  const user = await requireRole(["admin"]);
  await overrideQuarantineCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
    reason,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function renameEvidence(
  caseId: string,
  evidenceId: string,
  newFilename: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  await renameEvidenceCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
    newFilename,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function deleteEvidence(
  caseId: string,
  evidenceId: string,
  reason: string,
) {
  const user = await requireRole(["admin"]);
  await deleteEvidenceCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
    reason,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function setEvidenceLabels(
  caseId: string,
  evidenceId: string,
  labelsInput: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  await setLabelsCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
    labels: parseTagsInput(labelsInput),
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function setEvidenceRelevance(
  caseId: string,
  evidenceId: string,
  relevance: Attachment["relevance"],
) {
  const user = await requireRole(["admin", "analyst"]);
  await setRelevanceCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
    relevance,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function setEvidenceNotes(
  caseId: string,
  evidenceId: string,
  notes: string | null,
) {
  const user = await requireRole(["admin", "analyst"]);
  await setExaminerNotesCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
    notes,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function setEvidenceAcquisition(
  caseId: string,
  evidenceId: string,
  acquisitionSource: string | null,
  acquiredAt: string | null,
) {
  const user = await requireRole(["admin", "analyst"]);
  let parsedAcquiredAt: Date | null = null;
  if (acquiredAt) {
    parsedAcquiredAt = new Date(acquiredAt);
    if (Number.isNaN(parsedAcquiredAt.getTime())) {
      throw new Error("Invalid acquisition date/time");
    }
  }
  await setAcquisitionCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
    acquisitionSource: acquisitionSource?.trim() || null,
    acquiredAt: parsedAcquiredAt,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function createEvidenceCollection(
  caseId: string,
  name: string,
  description?: string | null,
) {
  const user = await requireRole(["admin", "analyst"]);
  await createCollectionCore({
    organisationId: user.organisationId,
    caseId,
    actorId: user.id,
    name,
    description,
  });
  revalidateEvidence(caseId);
}

export async function addEvidenceToCollection(
  caseId: string,
  collectionId: string,
  evidenceId: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  await addEvidenceToCollectionCore({
    collectionId,
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function removeEvidenceFromCollection(
  caseId: string,
  evidenceId: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  await removeEvidenceFromCollectionCore({
    evidenceId,
    organisationId: user.organisationId,
    actorId: user.id,
  });
  revalidateEvidence(caseId, evidenceId);
}

export async function applyEvidenceLegalHold(
  caseId: string,
  reason: string,
  evidenceId?: string | null,
) {
  const user = await requireRole(["admin"]);
  await applyLegalHoldCore({
    organisationId: user.organisationId,
    actorId: user.id,
    reason,
    caseId: evidenceId ? null : caseId,
    evidenceId: evidenceId ?? null,
  });
  revalidateEvidence(caseId, evidenceId ?? undefined);
}

export async function releaseEvidenceLegalHold(
  caseId: string,
  holdId: string,
  releaseReason: string,
  evidenceId?: string | null,
) {
  const user = await requireRole(["admin"]);
  await releaseLegalHoldCore({
    holdId,
    organisationId: user.organisationId,
    actorId: user.id,
    releaseReason,
  });
  revalidateEvidence(caseId, evidenceId ?? undefined);
}
