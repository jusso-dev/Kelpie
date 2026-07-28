"use server";

import { revalidatePath } from "next/cache";
import { requireRole, requireUser } from "@/lib/session";
import { enqueueKelpieJob } from "@/lib/jobs/enqueue";
import {
  attachTechniqueCore,
  listMappingsForCase,
  listMappingsForEntity,
  removeMappingCore,
  updateMappingCore,
  type MappingEntityType,
  type MappingInput,
  type MappingUpdateInput,
} from "@/lib/attack/mapping-core";
import { searchTechniques } from "@/lib/attack/catalog-core";
import {
  addStoryEntryCore,
  listStoryCore,
  reorderStoryEntryCore,
  removeStoryEntryCore,
  updateStoryEntryCore,
  type StoryEntryInput,
} from "@/lib/attack/story-core";
import {
  createD3fendMappingCore,
  listD3fendMappingsCore,
  removeD3fendMappingCore,
  type D3fendMappingInput,
} from "@/lib/attack/d3fend-core";
import {
  getCaseTemplateCoverage,
  getOrgCoverageStats,
  getPlaybookCoverage,
} from "@/lib/attack/coverage-core";
import { listCatalogVersions, rollbackCatalogImport } from "@/lib/attack/catalog-core";

export async function searchAttackTechniques(query: string, tactic?: string) {
  await requireUser();
  return searchTechniques({ query, tactic, limit: 25 });
}

export async function attachAttackTechnique(
  entityType: MappingEntityType,
  entityId: string,
  input: Omit<MappingInput, "entityType" | "entityId">,
  caseIdForRevalidate?: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await attachTechniqueCore(user.organisationId, user.id, {
    ...input,
    entityType,
    entityId,
  });
  if (caseIdForRevalidate) revalidatePath(`/cases/${caseIdForRevalidate}`);
  revalidatePath("/attack-coverage");
  return result;
}

export async function updateAttackMapping(
  mappingId: string,
  patch: MappingUpdateInput,
  caseIdForRevalidate?: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await updateMappingCore(user.organisationId, user.id, mappingId, patch);
  if (caseIdForRevalidate) revalidatePath(`/cases/${caseIdForRevalidate}`);
  revalidatePath("/attack-coverage");
  return result;
}

export async function removeAttackMapping(mappingId: string, caseIdForRevalidate?: string) {
  const user = await requireRole(["admin", "analyst"]);
  await removeMappingCore(user.organisationId, user.id, mappingId);
  if (caseIdForRevalidate) revalidatePath(`/cases/${caseIdForRevalidate}`);
  revalidatePath("/attack-coverage");
}

export async function listCaseAttackMappings(caseId: string) {
  const user = await requireUser();
  return listMappingsForCase(user.organisationId, caseId);
}

export async function listEntityAttackMappings(entityType: MappingEntityType, entityId: string) {
  const user = await requireUser();
  return listMappingsForEntity(user.organisationId, entityType, entityId);
}

export async function refreshAttackCatalog(sourceUrl?: string) {
  const user = await requireRole(["admin"]);
  await enqueueKelpieJob("refresh-attack-catalog", {
    attackCatalogSourceUrl: sourceUrl || undefined,
    attackCatalogActorId: user.id,
  });
  revalidatePath("/attack-coverage");
}

export async function rollbackAttackCatalog(catalogVersionId: string, reason: string) {
  await requireRole(["admin"]);
  const result = await rollbackCatalogImport(catalogVersionId, reason);
  revalidatePath("/attack-coverage");
  return result;
}

export async function listAttackCatalogVersions() {
  await requireRole(["admin"]);
  return listCatalogVersions();
}

export async function listAttackStory(caseId: string) {
  const user = await requireUser();
  return listStoryCore(user.organisationId, caseId);
}

export async function addAttackStoryEntry(caseId: string, input: StoryEntryInput) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await addStoryEntryCore(user.organisationId, user.id, caseId, input);
  revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function updateAttackStoryEntry(
  caseId: string,
  entryId: string,
  patch: Parameters<typeof updateStoryEntryCore>[4],
) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await updateStoryEntryCore(user.organisationId, user.id, caseId, entryId, patch);
  revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function reorderAttackStoryEntry(caseId: string, entryId: string, targetIndex: number) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await reorderStoryEntryCore(user.organisationId, user.id, caseId, entryId, targetIndex);
  revalidatePath(`/cases/${caseId}`);
  return result;
}

export async function removeAttackStoryEntry(caseId: string, entryId: string) {
  const user = await requireRole(["admin", "analyst"]);
  await removeStoryEntryCore(user.organisationId, user.id, caseId, entryId);
  revalidatePath(`/cases/${caseId}`);
}

export async function createD3fendMapping(input: D3fendMappingInput) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await createD3fendMappingCore(user.organisationId, user.id, input);
  revalidatePath("/attack-coverage");
  if (input.playbookId) revalidatePath(`/playbooks/${input.playbookId}`);
  return result;
}

export async function removeD3fendMapping(mappingId: string) {
  const user = await requireRole(["admin", "analyst"]);
  await removeD3fendMappingCore(user.organisationId, mappingId);
  revalidatePath("/attack-coverage");
}

export async function listD3fendMappings(filter: { playbookId?: string; responseActionId?: string } = {}) {
  const user = await requireUser();
  return listD3fendMappingsCore(user.organisationId, filter);
}

export async function getAttackCoverage() {
  const user = await requireUser();
  const [stats, playbookCoverage, templateCoverage] = await Promise.all([
    getOrgCoverageStats(user.organisationId),
    getPlaybookCoverage(user.organisationId),
    getCaseTemplateCoverage(user.organisationId),
  ]);
  return { stats, playbookCoverage, templateCoverage };
}
