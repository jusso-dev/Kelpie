/**
 * Review template CRUD with immutable versioning (issue #64).
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  reviewTemplateVersions,
  reviewTemplates,
  type ReviewTemplate,
  type ReviewTemplateVersion,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import {
  DEFAULT_REVIEW_SECTIONS,
  normaliseSectionConfigs,
  ReviewContentError,
} from "./content";
import {
  isCaseClassification,
  isCaseSeverity,
  type CaseClassification,
  type CaseSeverity,
  type ReviewSectionConfig,
} from "./types";

export class ReviewTemplateError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReviewTemplateError";
    this.status = status;
  }
}

export type ReviewTemplateView = ReviewTemplate & {
  version: ReviewTemplateVersion;
  sections: ReviewSectionConfig[];
};

export type CreateReviewTemplateInput = {
  name: string;
  description?: string | null;
  sections?: ReviewSectionConfig[] | unknown;
  requireApproval?: boolean;
  requiredSeverities?: CaseSeverity[];
  requiredClassifications?: CaseClassification[];
};

export type UpdateReviewTemplateInput = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  sections?: ReviewSectionConfig[] | unknown;
  requireApproval?: boolean;
  requiredSeverities?: CaseSeverity[];
  requiredClassifications?: CaseClassification[];
};

function parseSeverities(raw: unknown): CaseSeverity[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ReviewTemplateError("requiredSeverities must be an array");
  }
  return raw.map((s) => {
    if (typeof s !== "string" || !isCaseSeverity(s)) {
      throw new ReviewTemplateError(`Invalid severity: ${String(s)}`);
    }
    return s;
  });
}

function parseClassifications(raw: unknown): CaseClassification[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ReviewTemplateError("requiredClassifications must be an array");
  }
  return raw.map((c) => {
    if (typeof c !== "string" || !isCaseClassification(c)) {
      throw new ReviewTemplateError(`Invalid classification: ${String(c)}`);
    }
    return c;
  });
}

function toView(
  template: ReviewTemplate,
  version: ReviewTemplateVersion,
): ReviewTemplateView {
  let sections: ReviewSectionConfig[];
  try {
    sections = normaliseSectionConfigs(version.sections);
  } catch {
    sections = DEFAULT_REVIEW_SECTIONS;
  }
  return { ...template, version, sections };
}

export async function listReviewTemplatesCore(
  organisationId: string,
  opts?: { includeInactive?: boolean },
): Promise<ReviewTemplateView[]> {
  const rows = await db
    .select()
    .from(reviewTemplates)
    .where(
      opts?.includeInactive
        ? eq(reviewTemplates.organisationId, organisationId)
        : and(
            eq(reviewTemplates.organisationId, organisationId),
            eq(reviewTemplates.isActive, true),
          ),
    )
    .orderBy(reviewTemplates.name);

  const views: ReviewTemplateView[] = [];
  for (const template of rows) {
    const [version] = await db
      .select()
      .from(reviewTemplateVersions)
      .where(
        and(
          eq(reviewTemplateVersions.templateId, template.id),
          eq(reviewTemplateVersions.version, template.currentVersion),
          eq(reviewTemplateVersions.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (version) views.push(toView(template, version));
  }
  return views;
}

export async function getReviewTemplateCore(
  organisationId: string,
  templateId: string,
  versionNumber?: number,
): Promise<ReviewTemplateView | null> {
  const [template] = await db
    .select()
    .from(reviewTemplates)
    .where(
      and(
        eq(reviewTemplates.id, templateId),
        eq(reviewTemplates.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!template) return null;
  const version = versionNumber ?? template.currentVersion;
  const [row] = await db
    .select()
    .from(reviewTemplateVersions)
    .where(
      and(
        eq(reviewTemplateVersions.templateId, template.id),
        eq(reviewTemplateVersions.version, version),
        eq(reviewTemplateVersions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return toView(template, row);
}

export async function createReviewTemplateCore(
  organisationId: string,
  actorUserId: string | null,
  input: CreateReviewTemplateInput,
): Promise<ReviewTemplateView> {
  const name = input.name?.trim();
  if (!name) throw new ReviewTemplateError("Template name is required");
  if (name.length > 200) {
    throw new ReviewTemplateError("Template name must be at most 200 characters");
  }
  let sections: ReviewSectionConfig[];
  try {
    sections = input.sections
      ? normaliseSectionConfigs(input.sections)
      : DEFAULT_REVIEW_SECTIONS;
  } catch (err) {
    throw new ReviewTemplateError(
      err instanceof ReviewContentError ? err.message : "Invalid sections",
    );
  }
  const requiredSeverities = parseSeverities(input.requiredSeverities);
  const requiredClassifications = parseClassifications(
    input.requiredClassifications,
  );
  const templateId = newId("rev_tpl");
  const versionId = newId("rev_tpl_ver");
  const requireApproval = input.requireApproval !== false;

  await db.insert(reviewTemplates).values({
    id: templateId,
    organisationId,
    name,
    description: input.description?.trim() || null,
    isActive: true,
    currentVersion: 1,
    requiredSeverities,
    requiredClassifications,
    createdBy: actorUserId,
  });
  await db.insert(reviewTemplateVersions).values({
    id: versionId,
    templateId,
    organisationId,
    version: 1,
    sections,
    requireApproval,
    createdBy: actorUserId,
  });

  const view = await getReviewTemplateCore(organisationId, templateId);
  if (!view) throw new ReviewTemplateError("Failed to create template", 500);
  return view;
}

export async function updateReviewTemplateCore(
  organisationId: string,
  templateId: string,
  actorUserId: string | null,
  input: UpdateReviewTemplateInput,
): Promise<ReviewTemplateView> {
  const existing = await getReviewTemplateCore(organisationId, templateId);
  if (!existing) throw new ReviewTemplateError("Template not found", 404);

  const patch: Partial<typeof reviewTemplates.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ReviewTemplateError("Template name is required");
    if (name.length > 200) {
      throw new ReviewTemplateError("Template name must be at most 200 characters");
    }
    patch.name = name;
  }
  if (input.description !== undefined) {
    patch.description = input.description?.trim() || null;
  }
  if (input.isActive !== undefined) patch.isActive = input.isActive;
  if (input.requiredSeverities !== undefined) {
    patch.requiredSeverities = parseSeverities(input.requiredSeverities);
  }
  if (input.requiredClassifications !== undefined) {
    patch.requiredClassifications = parseClassifications(
      input.requiredClassifications,
    );
  }

  const versionFieldsTouched =
    input.sections !== undefined || input.requireApproval !== undefined;

  if (versionFieldsTouched) {
    let sections = existing.sections;
    if (input.sections !== undefined) {
      try {
        sections = normaliseSectionConfigs(input.sections);
      } catch (err) {
        throw new ReviewTemplateError(
          err instanceof ReviewContentError ? err.message : "Invalid sections",
        );
      }
    }
    const requireApproval =
      input.requireApproval !== undefined
        ? input.requireApproval
        : existing.version.requireApproval;
    const nextVersion = existing.currentVersion + 1;
    await db.insert(reviewTemplateVersions).values({
      id: newId("rev_tpl_ver"),
      templateId,
      organisationId,
      version: nextVersion,
      sections,
      requireApproval,
      createdBy: actorUserId,
    });
    patch.currentVersion = nextVersion;
  }

  await db
    .update(reviewTemplates)
    .set(patch)
    .where(
      and(
        eq(reviewTemplates.id, templateId),
        eq(reviewTemplates.organisationId, organisationId),
      ),
    );

  const view = await getReviewTemplateCore(organisationId, templateId);
  if (!view) throw new ReviewTemplateError("Template not found", 404);
  return view;
}

const BASELINE_CATALOGUE_KEY = "default_post_incident";

/** Idempotent seed of the default review template for an organisation. */
export async function seedBaselineReviewTemplates(
  organisationId: string,
  actorUserId?: string | null,
): Promise<{ created: number; skipped: number }> {
  const [existing] = await db
    .select({ id: reviewTemplates.id })
    .from(reviewTemplates)
    .where(
      and(
        eq(reviewTemplates.organisationId, organisationId),
        eq(reviewTemplates.catalogueKey, BASELINE_CATALOGUE_KEY),
      ),
    )
    .limit(1);
  if (existing) return { created: 0, skipped: 1 };

  const templateId = newId("rev_tpl");
  const versionId = newId("rev_tpl_ver");
  await db.insert(reviewTemplates).values({
    id: templateId,
    organisationId,
    name: "Standard post-incident review",
    description:
      "Default template: summary, impact, detection, root cause, gaps, and knowledge summary.",
    isActive: true,
    currentVersion: 1,
    requiredSeverities: ["high", "critical"],
    requiredClassifications: [],
    catalogueKey: BASELINE_CATALOGUE_KEY,
    createdBy: actorUserId ?? null,
  });
  await db.insert(reviewTemplateVersions).values({
    id: versionId,
    templateId,
    organisationId,
    version: 1,
    sections: DEFAULT_REVIEW_SECTIONS,
    requireApproval: true,
    createdBy: actorUserId ?? null,
  });
  return { created: 1, skipped: 0 };
}
