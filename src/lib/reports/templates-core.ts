/**
 * Admin-managed report template CRUD with immutable versioning (issue #47).
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  reportTemplateVersions,
  reportTemplates,
  type ReportTemplate,
  type ReportTemplateVersion,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import {
  BASELINE_REPORT_TEMPLATES,
  REPORT_CATALOGUE_VERSION,
  baselineSections,
} from "./defaults";
import {
  normaliseInclusionRules,
  normaliseSectionConfigs,
  ReportSelectionError,
} from "./selection";
import {
  isReportPap,
  isReportTlp,
  isReportVariant,
  type ReportInclusionRules,
  type ReportPap,
  type ReportSectionConfig,
  type ReportTlp,
  type ReportVariant,
} from "./types";

export class ReportTemplateError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReportTemplateError";
    this.status = status;
  }
}

export type TemplateView = ReportTemplate & {
  version: ReportTemplateVersion;
  sections: ReportSectionConfig[];
  inclusionRules: ReportInclusionRules;
};

export type CreateTemplateInput = {
  name: string;
  description?: string | null;
  variant: ReportVariant;
  sections: ReportSectionConfig[] | unknown;
  inclusionRules?: ReportInclusionRules | unknown;
  requireApproval?: boolean;
  maxTlp?: ReportTlp;
  maxPap?: ReportPap;
};

export type UpdateTemplateInput = {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  /** When any of these are set, a new immutable version is created. */
  sections?: ReportSectionConfig[] | unknown;
  inclusionRules?: ReportInclusionRules | unknown;
  requireApproval?: boolean;
  maxTlp?: ReportTlp;
  maxPap?: ReportPap;
};

function toView(
  template: ReportTemplate,
  version: ReportTemplateVersion,
): TemplateView {
  return {
    ...template,
    version,
    sections: normaliseSectionConfigs(version.sections),
    inclusionRules: normaliseInclusionRules(version.inclusionRules),
  };
}

export async function listReportTemplatesCore(
  organisationId: string,
  opts?: { includeInactive?: boolean },
): Promise<TemplateView[]> {
  const rows = await db
    .select()
    .from(reportTemplates)
    .where(
      opts?.includeInactive
        ? eq(reportTemplates.organisationId, organisationId)
        : and(
            eq(reportTemplates.organisationId, organisationId),
            eq(reportTemplates.isActive, true),
          ),
    )
    .orderBy(reportTemplates.name);

  const views: TemplateView[] = [];
  for (const template of rows) {
    const [version] = await db
      .select()
      .from(reportTemplateVersions)
      .where(
        and(
          eq(reportTemplateVersions.templateId, template.id),
          eq(reportTemplateVersions.version, template.currentVersion),
          eq(reportTemplateVersions.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (version) views.push(toView(template, version));
  }
  return views;
}

export async function getReportTemplateCore(
  organisationId: string,
  templateId: string,
  versionNumber?: number,
): Promise<TemplateView | null> {
  const [template] = await db
    .select()
    .from(reportTemplates)
    .where(
      and(
        eq(reportTemplates.id, templateId),
        eq(reportTemplates.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!template) return null;

  const version = versionNumber ?? template.currentVersion;
  const [row] = await db
    .select()
    .from(reportTemplateVersions)
    .where(
      and(
        eq(reportTemplateVersions.templateId, template.id),
        eq(reportTemplateVersions.version, version),
        eq(reportTemplateVersions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) return null;
  return toView(template, row);
}

export async function getReportTemplateVersionById(
  organisationId: string,
  versionId: string,
): Promise<{ template: ReportTemplate; version: ReportTemplateVersion } | null> {
  const [version] = await db
    .select()
    .from(reportTemplateVersions)
    .where(
      and(
        eq(reportTemplateVersions.id, versionId),
        eq(reportTemplateVersions.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!version) return null;
  const [template] = await db
    .select()
    .from(reportTemplates)
    .where(
      and(
        eq(reportTemplates.id, version.templateId),
        eq(reportTemplates.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!template) return null;
  return { template, version };
}

function parseCreate(input: CreateTemplateInput) {
  const name = input.name?.trim();
  if (!name) throw new ReportTemplateError("Template name is required");
  if (name.length > 200) {
    throw new ReportTemplateError("Template name must be at most 200 characters");
  }
  if (!isReportVariant(input.variant)) {
    throw new ReportTemplateError("Invalid report variant");
  }
  let sections: ReportSectionConfig[];
  try {
    sections = normaliseSectionConfigs(input.sections);
  } catch (err) {
    throw new ReportTemplateError(
      err instanceof ReportSelectionError ? err.message : "Invalid sections",
    );
  }
  if (sections.length === 0) {
    throw new ReportTemplateError("At least one section is required");
  }
  let inclusionRules: ReportInclusionRules;
  try {
    inclusionRules = normaliseInclusionRules(input.inclusionRules ?? {});
  } catch (err) {
    throw new ReportTemplateError(
      err instanceof ReportSelectionError ? err.message : "Invalid inclusion rules",
    );
  }
  const maxTlp = input.maxTlp ?? inclusionRules.maxTlp ?? "amber";
  const maxPap = input.maxPap ?? inclusionRules.maxPap ?? "amber";
  if (!isReportTlp(maxTlp)) throw new ReportTemplateError("Invalid maxTlp");
  if (!isReportPap(maxPap)) throw new ReportTemplateError("Invalid maxPap");
  inclusionRules = { ...inclusionRules, maxTlp, maxPap };
  return {
    name,
    description: input.description?.trim() || null,
    variant: input.variant,
    sections,
    inclusionRules,
    requireApproval: Boolean(input.requireApproval),
    maxTlp,
    maxPap,
  };
}

export async function createReportTemplateCore(
  organisationId: string,
  actorId: string | null,
  input: CreateTemplateInput,
): Promise<TemplateView> {
  const parsed = parseCreate(input);
  const templateId = newId("rpt");
  const versionId = newId("rptv");
  await db.insert(reportTemplates).values({
    id: templateId,
    organisationId,
    name: parsed.name,
    description: parsed.description,
    variant: parsed.variant,
    isActive: true,
    currentVersion: 1,
    createdBy: actorId,
  });
  await db.insert(reportTemplateVersions).values({
    id: versionId,
    templateId,
    organisationId,
    version: 1,
    sections: parsed.sections,
    inclusionRules: parsed.inclusionRules,
    requireApproval: parsed.requireApproval,
    maxTlp: parsed.maxTlp,
    maxPap: parsed.maxPap,
    createdBy: actorId,
  });
  const view = await getReportTemplateCore(organisationId, templateId);
  if (!view) throw new ReportTemplateError("Failed to create template", 500);
  return view;
}

/**
 * Update metadata and/or create a new immutable version when sections/rules change.
 */
export async function updateReportTemplateCore(
  organisationId: string,
  actorId: string | null,
  templateId: string,
  input: UpdateTemplateInput,
): Promise<TemplateView> {
  const existing = await getReportTemplateCore(organisationId, templateId);
  if (!existing) throw new ReportTemplateError("Template not found", 404);

  const name =
    input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) throw new ReportTemplateError("Template name is required");

  const description =
    input.description !== undefined
      ? input.description?.trim() || null
      : existing.description;

  const isActive =
    input.isActive !== undefined ? input.isActive : existing.isActive;

  const versionFieldsTouched =
    input.sections !== undefined ||
    input.inclusionRules !== undefined ||
    input.requireApproval !== undefined ||
    input.maxTlp !== undefined ||
    input.maxPap !== undefined;

  let currentVersion = existing.currentVersion;

  if (versionFieldsTouched) {
    let sections = existing.sections;
    if (input.sections !== undefined) {
      try {
        sections = normaliseSectionConfigs(input.sections);
      } catch (err) {
        throw new ReportTemplateError(
          err instanceof ReportSelectionError ? err.message : "Invalid sections",
        );
      }
      if (sections.length === 0) {
        throw new ReportTemplateError("At least one section is required");
      }
    }
    let inclusionRules = existing.inclusionRules;
    if (input.inclusionRules !== undefined) {
      try {
        inclusionRules = normaliseInclusionRules(input.inclusionRules);
      } catch (err) {
        throw new ReportTemplateError(
          err instanceof ReportSelectionError
            ? err.message
            : "Invalid inclusion rules",
        );
      }
    }
    const maxTlp = input.maxTlp ?? (existing.version.maxTlp as ReportTlp);
    const maxPap = input.maxPap ?? (existing.version.maxPap as ReportPap);
    if (!isReportTlp(maxTlp)) throw new ReportTemplateError("Invalid maxTlp");
    if (!isReportPap(maxPap)) throw new ReportTemplateError("Invalid maxPap");
    inclusionRules = { ...inclusionRules, maxTlp, maxPap };
    const requireApproval =
      input.requireApproval !== undefined
        ? Boolean(input.requireApproval)
        : existing.version.requireApproval;

    currentVersion = existing.currentVersion + 1;
    await db.insert(reportTemplateVersions).values({
      id: newId("rptv"),
      templateId,
      organisationId,
      version: currentVersion,
      sections,
      inclusionRules,
      requireApproval,
      maxTlp,
      maxPap,
      createdBy: actorId,
    });
  }

  await db
    .update(reportTemplates)
    .set({
      name,
      description,
      isActive,
      currentVersion,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reportTemplates.id, templateId),
        eq(reportTemplates.organisationId, organisationId),
      ),
    );

  const view = await getReportTemplateCore(organisationId, templateId);
  if (!view) throw new ReportTemplateError("Template not found", 404);
  return view;
}

export async function listTemplateVersionsCore(
  organisationId: string,
  templateId: string,
): Promise<ReportTemplateVersion[]> {
  const [template] = await db
    .select({ id: reportTemplates.id })
    .from(reportTemplates)
    .where(
      and(
        eq(reportTemplates.id, templateId),
        eq(reportTemplates.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!template) throw new ReportTemplateError("Template not found", 404);
  return db
    .select()
    .from(reportTemplateVersions)
    .where(
      and(
        eq(reportTemplateVersions.templateId, templateId),
        eq(reportTemplateVersions.organisationId, organisationId),
      ),
    )
    .orderBy(desc(reportTemplateVersions.version));
}

/**
 * Seed baseline report templates for an organisation. Idempotent by catalogueKey.
 * Never overwrites an existing catalogue row (local edits are preserved).
 */
export async function seedBaselineReportTemplates(
  organisationId: string,
  actorId: string | null = null,
): Promise<{ created: number; skipped: number }> {
  const existing = await db
    .select({
      id: reportTemplates.id,
      catalogueKey: reportTemplates.catalogueKey,
    })
    .from(reportTemplates)
    .where(eq(reportTemplates.organisationId, organisationId));
  const byKey = new Set(
    existing.filter((r) => r.catalogueKey).map((r) => r.catalogueKey as string),
  );

  let created = 0;
  let skipped = 0;
  for (const baseline of BASELINE_REPORT_TEMPLATES) {
    if (byKey.has(baseline.key)) {
      skipped += 1;
      continue;
    }
    const templateId = newId("rpt");
    const versionId = newId("rptv");
    const sections = baselineSections(baseline);
    const inclusionRules: ReportInclusionRules = {
      ...baseline.inclusionRules,
      maxTlp: baseline.maxTlp,
      maxPap: baseline.maxPap,
    };
    const inserted = await db
      .insert(reportTemplates)
      .values({
        id: templateId,
        organisationId,
        name: baseline.name,
        description: baseline.description,
        variant: baseline.variant,
        isActive: true,
        currentVersion: 1,
        catalogueKey: baseline.key,
        catalogueVersion: REPORT_CATALOGUE_VERSION,
        createdBy: actorId,
      })
      .onConflictDoNothing()
      .returning({ id: reportTemplates.id });
    if (inserted.length === 0) {
      skipped += 1;
      continue;
    }
    await db.insert(reportTemplateVersions).values({
      id: versionId,
      templateId,
      organisationId,
      version: 1,
      sections,
      inclusionRules,
      requireApproval: baseline.requireApproval,
      maxTlp: baseline.maxTlp ?? "amber",
      maxPap: baseline.maxPap ?? "amber",
      createdBy: actorId,
    });
    created += 1;
  }
  return { created, skipped };
}
