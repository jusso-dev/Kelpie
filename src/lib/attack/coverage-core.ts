/**
 * Organisation-wide ATT&CK coverage: which techniques this org has actually
 * mapped, what still needs analyst attention, and where playbooks/case
 * templates do (or don't) document investigation/detection/containment/
 * recovery guidance for those techniques.
 */
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attackTechniqueMappings,
  caseTemplates,
  playbooks,
  type PlaybookStep,
} from "@/db/schema";
import {
  PLAYBOOK_GUIDANCE_CATEGORIES,
  type PlaybookGuidanceCategory,
} from "./playbook-guidance";
import { getTechniquesByIds } from "./catalog-core";
import { findTactic } from "./tactics";

export type GuidanceIndex = Record<PlaybookGuidanceCategory, Set<string>>;

function emptyGuidanceIndex(): GuidanceIndex {
  return {
    investigation: new Set(),
    detection: new Set(),
    containment: new Set(),
    recovery: new Set(),
  };
}

/** Pure — which technique ids each guidance category documents across a playbook's steps. */
export function computeStepGuidanceIndex(steps: PlaybookStep[]): GuidanceIndex {
  const index = emptyGuidanceIndex();
  for (const step of steps) {
    const categories = step.guidanceCategories ?? [];
    const techniqueIds = step.attackTechniqueIds ?? [];
    if (categories.length === 0 || techniqueIds.length === 0) continue;
    for (const category of categories) {
      for (const techniqueId of techniqueIds) {
        index[category].add(techniqueId);
      }
    }
  }
  return index;
}

/** Pure — for each guidance category, which of the org's mapped techniques this index does NOT document. */
export function computeCoverageGaps(
  mappedTechniqueIds: string[],
  documented: GuidanceIndex,
): Record<PlaybookGuidanceCategory, string[]> {
  const gaps = {} as Record<PlaybookGuidanceCategory, string[]>;
  for (const category of PLAYBOOK_GUIDANCE_CATEGORIES) {
    gaps[category] = mappedTechniqueIds.filter((id) => !documented[category].has(id));
  }
  return gaps;
}

function serialiseIndex(index: GuidanceIndex): Record<PlaybookGuidanceCategory, string[]> {
  const out = {} as Record<PlaybookGuidanceCategory, string[]>;
  for (const category of PLAYBOOK_GUIDANCE_CATEGORIES) {
    out[category] = [...index[category]].sort();
  }
  return out;
}

export type OrgCoverageStats = {
  totalMappings: number;
  totalMappedTechniques: number;
  byTactic: Array<{ tacticId: string; tacticName: string; mappedTechniqueCount: number }>;
  unresolvedCount: number;
  unresolvedMappings: Array<{
    id: string;
    techniqueId: string;
    entityType: string;
    entityId: string;
    caseId: string | null;
    createdAt: Date;
  }>;
};

/**
 * "Unresolved work" is a mapping that has neither detection nor response
 * guidance recorded yet — i.e. an analyst tagged the behaviour but has not
 * yet written up how it was detected or how to respond to it.
 */
export async function getOrgCoverageStats(organisationId: string): Promise<OrgCoverageStats> {
  const mappings = await db
    .select()
    .from(attackTechniqueMappings)
    .where(eq(attackTechniqueMappings.organisationId, organisationId));

  const techniqueIds = [...new Set(mappings.map((m) => m.techniqueId))];
  const techniques = await getTechniquesByIds(techniqueIds);
  const tacticsByTechnique = new Map(
    techniques.map((t) => [t.techniqueId, (t.tactics as Array<{ id: string; name: string }>) ?? []]),
  );

  const tacticCounts = new Map<string, { name: string; techniques: Set<string> }>();
  for (const techniqueId of techniqueIds) {
    const tactics = tacticsByTechnique.get(techniqueId) ?? [];
    for (const tactic of tactics) {
      const entry = tacticCounts.get(tactic.id) ?? {
        name: findTactic(tactic.id)?.name ?? tactic.name,
        techniques: new Set<string>(),
      };
      entry.techniques.add(techniqueId);
      tacticCounts.set(tactic.id, entry);
    }
  }

  const unresolved = mappings
    .filter((m) => !m.detectionNotes && !m.responseNotes)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return {
    totalMappings: mappings.length,
    totalMappedTechniques: techniqueIds.length,
    byTactic: [...tacticCounts.entries()]
      .map(([tacticId, v]) => ({
        tacticId,
        tacticName: v.name,
        mappedTechniqueCount: v.techniques.size,
      }))
      .sort((a, b) => b.mappedTechniqueCount - a.mappedTechniqueCount),
    unresolvedCount: unresolved.length,
    unresolvedMappings: unresolved.slice(0, 50).map((m) => ({
      id: m.id,
      techniqueId: m.techniqueId,
      entityType: m.entityType,
      entityId: m.entityId,
      caseId: m.caseId,
      createdAt: m.createdAt,
    })),
  };
}

export type PlaybookCoverageEntry = {
  playbookId: string;
  playbookName: string;
  documented: Record<PlaybookGuidanceCategory, string[]>;
  gaps: Record<PlaybookGuidanceCategory, string[]>;
};

export type TemplateCoverageEntry = {
  templateId: string;
  templateName: string;
  playbookId: string | null;
  playbookName: string | null;
  documented: Record<PlaybookGuidanceCategory, string[]>;
  gaps: Record<PlaybookGuidanceCategory, string[]>;
};

async function orgMappedTechniqueIds(organisationId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ techniqueId: attackTechniqueMappings.techniqueId })
    .from(attackTechniqueMappings)
    .where(eq(attackTechniqueMappings.organisationId, organisationId));
  return rows.map((r) => r.techniqueId);
}

export async function getPlaybookCoverage(
  organisationId: string,
): Promise<PlaybookCoverageEntry[]> {
  const mappedTechniqueIds = await orgMappedTechniqueIds(organisationId);
  const rows = await db
    .select({ id: playbooks.id, name: playbooks.name, steps: playbooks.steps })
    .from(playbooks)
    .where(and(eq(playbooks.organisationId, organisationId), eq(playbooks.isActive, true)))
    .orderBy(desc(playbooks.createdAt));

  return rows.map((row) => {
    const index = computeStepGuidanceIndex((row.steps as PlaybookStep[]) ?? []);
    return {
      playbookId: row.id,
      playbookName: row.name,
      documented: serialiseIndex(index),
      gaps: computeCoverageGaps(mappedTechniqueIds, index),
    };
  });
}

export async function getCaseTemplateCoverage(
  organisationId: string,
): Promise<TemplateCoverageEntry[]> {
  const mappedTechniqueIds = await orgMappedTechniqueIds(organisationId);
  const rows = await db
    .select({
      id: caseTemplates.id,
      name: caseTemplates.name,
      playbookId: caseTemplates.defaultPlaybookId,
      playbookName: playbooks.name,
      steps: playbooks.steps,
    })
    .from(caseTemplates)
    .leftJoin(playbooks, eq(playbooks.id, caseTemplates.defaultPlaybookId))
    .where(eq(caseTemplates.organisationId, organisationId));

  return rows.map((row) => {
    const index = row.steps
      ? computeStepGuidanceIndex((row.steps as PlaybookStep[]) ?? [])
      : emptyGuidanceIndex();
    return {
      templateId: row.id,
      templateName: row.name,
      playbookId: row.playbookId,
      playbookName: row.playbookName,
      documented: serialiseIndex(index),
      gaps: computeCoverageGaps(mappedTechniqueIds, index),
    };
  });
}
