/**
 * Seed (and re-sync) the baseline playbook catalogue for an organisation.
 *
 * `seedBaselineOrganisationData` is safe to call for any organisation at any
 * time, as many times as needed:
 *
 * - It looks up existing rows by `(organisationId, catalogueKey)`, never by
 *   name or position, so re-running it after the catalogue gains new
 *   scenarios only inserts the missing ones.
 * - It never updates a row that already exists for a given key, so an
 *   organisation's edits to a baseline playbook/template (or an outright
 *   replacement with a custom one under the same slot) are never reverted.
 * - Case templates are linked to their baseline playbook via
 *   `defaultPlaybookId`, resolved from whatever playbook id already exists
 *   (or was just created) for that scenario's key in this organisation.
 *
 * See `src/lib/playbook-catalogue.ts` for the catalogue content and
 * maintenance rules.
 */
import { db } from "@/db";
import { caseTemplates, playbooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "./utils";
import {
  BASELINE_PLAYBOOKS,
  BASELINE_TEMPLATES,
  PLAYBOOK_CATALOGUE_VERSION,
} from "./playbook-catalogue";

export type BaselineSeedResult = {
  playbooksCreated: number;
  templatesCreated: number;
  playbooksSkipped: number;
  templatesSkipped: number;
  /** Existing baseline templates whose `defaultPlaybookId` had gone `null`
   * (e.g. because the linked playbook was deleted and just got recreated by
   * this same sync) and were re-pointed at the current playbook for their
   * catalogue key. This repairs a dangling link; it never touches any other
   * field on the template, so it is not "overwriting a local edit". */
  templatesRelinked: number;
};

export async function seedBaselineOrganisationData(
  organisationId: string,
): Promise<BaselineSeedResult> {
  const existingPlaybooks = await db
    .select({ id: playbooks.id, catalogueKey: playbooks.catalogueKey })
    .from(playbooks)
    .where(eq(playbooks.organisationId, organisationId));

  const playbookIdsByKey = new Map<string, string>();
  for (const row of existingPlaybooks) {
    if (row.catalogueKey) playbookIdsByKey.set(row.catalogueKey, row.id);
  }

  let playbooksCreated = 0;
  let playbooksSkipped = 0;
  for (const baseline of BASELINE_PLAYBOOKS) {
    if (playbookIdsByKey.has(baseline.key)) {
      playbooksSkipped++;
      continue;
    }
    const id = newId("pb");
    const created = await db.insert(playbooks).values({
      id,
      organisationId,
      name: baseline.name,
      description: baseline.description,
      classification: baseline.classification,
      defaultSeverity: baseline.defaultSeverity,
      isActive: true,
      steps: baseline.steps.map((step) => ({
        id: newId("step"),
        ...step,
      })),
      content: baseline.content,
      tags: baseline.tags,
      requiredObservableTypes: baseline.requiredObservableTypes,
      catalogueKey: baseline.key,
      catalogueVersion: PLAYBOOK_CATALOGUE_VERSION,
    })
      // The read above and this write are not in one transaction, so two
      // concurrent syncs for the same organisation can both decide a key is
      // missing. The unique index on (organisationId, catalogueKey) settles
      // it; without this the loser would throw mid-loop and leave the
      // organisation partially synced.
      .onConflictDoNothing()
      .returning({ id: playbooks.id });
    if (created.length === 0) {
      const [winner] = await db
        .select({ id: playbooks.id })
        .from(playbooks)
        .where(
          and(
            eq(playbooks.organisationId, organisationId),
            eq(playbooks.catalogueKey, baseline.key),
          ),
        )
        .limit(1);
      if (winner) playbookIdsByKey.set(baseline.key, winner.id);
      playbooksSkipped++;
      continue;
    }
    playbookIdsByKey.set(baseline.key, id);
    playbooksCreated++;
  }

  const existingTemplates = await db
    .select({
      id: caseTemplates.id,
      catalogueKey: caseTemplates.catalogueKey,
      defaultPlaybookId: caseTemplates.defaultPlaybookId,
    })
    .from(caseTemplates)
    .where(eq(caseTemplates.organisationId, organisationId));
  const existingTemplatesByKey = new Map(
    existingTemplates
      .filter((row): row is typeof row & { catalogueKey: string } => row.catalogueKey !== null)
      .map((row) => [row.catalogueKey, row]),
  );

  let templatesCreated = 0;
  let templatesSkipped = 0;
  let templatesRelinked = 0;
  for (const template of BASELINE_TEMPLATES) {
    const existing = existingTemplatesByKey.get(template.key);
    if (existing) {
      templatesSkipped++;
      // Repair a dangling playbook link (e.g. the linked baseline playbook
      // was deleted and this sync just recreated it under the same key).
      // This only ever fills a `null` link back in — it never changes any
      // other field, and never touches a template that still has a valid
      // link, so it cannot revert an intentional customisation.
      const resolvedPlaybookId = playbookIdsByKey.get(template.playbookKey);
      if (!existing.defaultPlaybookId && resolvedPlaybookId) {
        await db
          .update(caseTemplates)
          .set({ defaultPlaybookId: resolvedPlaybookId })
          .where(eq(caseTemplates.id, existing.id));
        templatesRelinked++;
      }
      continue;
    }
    const createdTemplate = await db.insert(caseTemplates).values({
      id: newId("ct"),
      organisationId,
      name: template.name,
      classification: template.classification,
      defaultSeverity: template.defaultSeverity,
      defaultTlp: template.defaultTlp,
      summaryTemplate: template.summaryTemplate,
      defaultPlaybookId: playbookIdsByKey.get(template.playbookKey) ?? null,
      defaultTags: template.defaultTags,
      defaultDataClassificationTags: template.defaultDataClassificationTags,
      defaultTasks: template.defaultTasks,
      catalogueKey: template.key,
      catalogueVersion: PLAYBOOK_CATALOGUE_VERSION,
    })
      // Same concurrent-sync race as the playbook insert above.
      .onConflictDoNothing()
      .returning({ id: caseTemplates.id });
    if (createdTemplate.length === 0) {
      templatesSkipped++;
      continue;
    }
    templatesCreated++;
  }

  return {
    playbooksCreated,
    templatesCreated,
    playbooksSkipped,
    templatesSkipped,
    templatesRelinked,
  };
}

/**
 * Whether an organisation is missing any baseline catalogue entry — used to
 * decide whether to surface a "sync catalogue" action in the UI without
 * writing anything.
 */
export async function baselineCatalogueIsBehind(
  organisationId: string,
): Promise<boolean> {
  const existingKeys = new Set(
    (
      await db
        .select({ catalogueKey: playbooks.catalogueKey })
        .from(playbooks)
        .where(eq(playbooks.organisationId, organisationId))
    )
      .map((row) => row.catalogueKey)
      .filter((key): key is string => key !== null),
  );
  return BASELINE_PLAYBOOKS.some((baseline) => !existingKeys.has(baseline.key));
}
