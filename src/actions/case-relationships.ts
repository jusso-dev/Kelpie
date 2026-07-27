"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/lib/session";
import {
  RELATIONSHIP_TYPES,
  dismissSuggestionCore,
  linkCasesCore,
  scoreDraftCandidatesCore,
  unlinkCaseCore,
  type CaseRelationshipView,
  type RelationshipTypeInput,
  type SuggestionView,
} from "@/lib/case-relationships-core";

export async function linkCases(
  caseId: string,
  targetCaseId: string,
  relationshipType: string,
  reason: string,
  confidence?: number | null,
): Promise<CaseRelationshipView> {
  const user = await requireRole(["admin", "analyst"]);
  if (!(RELATIONSHIP_TYPES as readonly string[]).includes(relationshipType)) {
    throw new Error("Unknown relationship type");
  }
  const result = await linkCasesCore(user.organisationId, user.id, caseId, {
    targetCaseId,
    relationshipType: relationshipType as RelationshipTypeInput,
    reason,
    confidence: confidence ?? null,
  });
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${targetCaseId}`);
  return result;
}

export async function unlinkCase(
  caseId: string,
  relationshipId: string,
  reason: string,
): Promise<void> {
  const user = await requireRole(["admin", "analyst"]);
  await unlinkCaseCore(user.organisationId, user.id, caseId, relationshipId, reason);
  revalidatePath(`/cases/${caseId}`);
}

export async function dismissSuggestion(
  caseId: string,
  candidateCaseId: string,
  reason: string,
): Promise<void> {
  const user = await requireRole(["admin", "analyst"]);
  await dismissSuggestionCore(user.organisationId, user.id, caseId, candidateCaseId, reason);
  revalidatePath(`/cases/${caseId}`);
}

export async function getRelationshipSuggestionsForDraft(
  title: string,
  summary: string,
  tags: string[],
): Promise<SuggestionView[]> {
  const user = await requireUser();
  return scoreDraftCandidatesCore(user.organisationId, { title, summary, tags });
}
