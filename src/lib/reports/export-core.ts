/**
 * Controlled case report export lifecycle (issue #47).
 *
 * Flow:
 * 1. createReportExportCore → pending row + optional enqueue
 * 2. processReportExportJob → build, render, store, stamp SHA-256
 * 3. If requireApproval → awaiting_approval + approval row
 *    Else → completed (downloadable)
 * 4. approveReportExportCore → released (downloadable)
 * 5. download only when completed/released and org-scoped
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  reportExportApprovals,
  reportExports,
  reportSchedules,
  users,
  type ReportExport,
  type ReportExportApproval,
} from "@/db/schema";
import { putFile, readFile } from "@/lib/storage";
import { newId } from "@/lib/utils";
import {
  buildCaseReportForTemplate,
  caseExistsInOrg,
  CaseTlpCeilingError,
} from "./build";
import {
  computeContentFingerprint,
  sha256Hex,
} from "./fingerprint";
import { renderTemplatedJson, renderTemplatedMarkdown, renderTemplatedPdf } from "./render";
import {
  getReportTemplateCore,
  getReportTemplateVersionById,
} from "./templates-core";
import type {
  ReportExportFormat,
  ReportPap,
  ReportSectionKey,
  ReportStamp,
  ReportTlp,
  ReportVariant,
  SectionOverrideMap,
} from "./types";
import { classifyLabel, isReportExportFormat } from "./types";
import {
  includedSectionKeys,
  normaliseInclusionRules,
  normaliseSectionConfigs,
  selectSections,
} from "./selection";

export class ReportExportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReportExportError";
    this.status = status;
  }
}

const DOWNLOADABLE = new Set(["completed", "released"]);

export type PreviewResult = {
  templateId: string;
  templateName: string;
  templateVersionId: string;
  templateVersion: number;
  variant: ReportVariant;
  maxTlp: ReportTlp;
  maxPap: ReportPap;
  requireApproval: boolean;
  selectedSections: ReturnType<
    typeof import("./selection").selectSections
  >;
  includedKeys: ReportSectionKey[];
  dataRevision: string;
  contentFingerprint: string;
  redaction: import("./types").RedactionPreview;
  /** Safe Markdown preview of what generation will produce (no hidden content). */
  markdownPreview: string;
};

export async function previewReportCore(opts: {
  organisationId: string;
  caseId: string;
  templateId: string;
  templateVersion?: number;
  overrides?: SectionOverrideMap;
  format?: ReportExportFormat;
}): Promise<PreviewResult> {
  const template = await getReportTemplateCore(
    opts.organisationId,
    opts.templateId,
    opts.templateVersion,
  );
  if (!template || !template.isActive) {
    throw new ReportExportError("Report template not found", 404);
  }

  const maxTlp = (template.version.maxTlp as ReportTlp) ?? "amber";
  const maxPap = (template.version.maxPap as ReportPap) ?? "amber";
  let built;
  try {
    built = await buildCaseReportForTemplate({
      organisationId: opts.organisationId,
      caseId: opts.caseId,
      sections: template.sections,
      inclusionRules: template.inclusionRules,
      overrides: opts.overrides,
      maxTlp,
      maxPap,
    });
  } catch (error) {
    throw mapBuildError(error);
  }
  if (!built) throw new ReportExportError("Case not found", 404);

  const format = opts.format ?? "pdf";
  const contentFingerprint = computeContentFingerprint({
    templateVersionId: template.version.id,
    templateVersionNumber: template.version.version,
    variant: template.variant as ReportVariant,
    maxTlp,
    maxPap,
    selectedSections: built.includedKeys,
    dataRevision: built.dataRevision,
    destination: "export_history",
    format,
  });

  const stamp: ReportStamp = {
    caseNumber: built.data.case.caseNumber,
    caseId: built.data.case.id,
    generatedAt: new Date().toISOString(),
    templateId: template.id,
    templateName: template.name,
    templateVersion: template.version.version,
    templateVersionId: template.version.id,
    variant: template.variant as ReportVariant,
    format,
    generatedByUserId: null,
    sha256: null,
    contentFingerprint,
    dataRevision: built.dataRevision,
    maxTlp,
    maxPap,
  };

  return {
    templateId: template.id,
    templateName: template.name,
    templateVersionId: template.version.id,
    templateVersion: template.version.version,
    variant: template.variant as ReportVariant,
    maxTlp,
    maxPap,
    requireApproval: template.version.requireApproval,
    selectedSections: built.selected,
    includedKeys: built.includedKeys,
    dataRevision: built.dataRevision,
    contentFingerprint,
    redaction: built.redaction,
    markdownPreview: renderTemplatedMarkdown(built, stamp),
  };
}

export async function createReportExportCore(opts: {
  organisationId: string;
  caseId: string;
  templateId: string;
  templateVersion?: number;
  format: ReportExportFormat;
  overrides?: SectionOverrideMap;
  requestedBy: string | null;
  scheduleId?: string | null;
  /** When true, process inline (tests / no worker). */
  processInline?: boolean;
}): Promise<ReportExport> {
  if (!isReportExportFormat(opts.format)) {
    throw new ReportExportError("format must be pdf or json");
  }
  if (!(await caseExistsInOrg(opts.organisationId, opts.caseId))) {
    throw new ReportExportError("Case not found", 404);
  }
  const template = await getReportTemplateCore(
    opts.organisationId,
    opts.templateId,
    opts.templateVersion,
  );
  if (!template || !template.isActive) {
    throw new ReportExportError("Report template not found", 404);
  }

  const maxTlp = template.version.maxTlp as ReportTlp;
  const maxPap = template.version.maxPap as ReportPap;
  const id = newId("rpex");

  // Snapshot selection keys for the row; full build happens in the job.
  const selected = selectSections(
    template.sections,
    template.inclusionRules,
    opts.overrides ?? {},
  );
  const included = includedSectionKeys(selected);

  await db.insert(reportExports).values({
    id,
    organisationId: opts.organisationId,
    caseId: opts.caseId,
    templateId: template.id,
    templateVersionId: template.version.id,
    templateVersionNumber: template.version.version,
    variant: template.variant,
    format: opts.format,
    status: "pending",
    selectedSections: included,
    maxTlp,
    maxPap,
    requireApproval: template.version.requireApproval,
    requestedBy: opts.requestedBy,
    scheduleId: opts.scheduleId ?? null,
    // Store overrides so the job can re-apply them (schema stays lean).
    redactionSummary: {
      pendingOverrides: opts.overrides ?? {},
    },
  });

  if (opts.processInline) {
    await processReportExportJob(id);
  }

  const [row] = await db
    .select()
    .from(reportExports)
    .where(eq(reportExports.id, id))
    .limit(1);
  if (!row) throw new ReportExportError("Failed to create export", 500);
  return row;
}

/**
 * BullMQ (or inline) processor. Idempotent for already-terminal rows.
 */
export async function processReportExportJob(exportId: string): Promise<void> {
  const [job] = await db
    .select()
    .from(reportExports)
    .where(eq(reportExports.id, exportId))
    .limit(1);
  if (!job) return;
  if (
    job.status === "completed" ||
    job.status === "released" ||
    job.status === "awaiting_approval"
  ) {
    return;
  }

  await db
    .update(reportExports)
    .set({ status: "processing" })
    .where(
      and(eq(reportExports.id, exportId), eq(reportExports.status, "pending")),
    );

  try {
    if (!job.templateVersionId) {
      throw new Error("Export is missing template version");
    }
    const resolved = await getReportTemplateVersionById(
      job.organisationId,
      job.templateVersionId,
    );
    if (!resolved) throw new Error("Template version no longer available");

    const { template, version } = resolved;
    const inclusionRules = normaliseInclusionRules(version.inclusionRules);
    const sections = normaliseSectionConfigs(version.sections);

    const pending = (job.redactionSummary ?? {}) as {
      pendingOverrides?: SectionOverrideMap;
    };
    const overrides = pending.pendingOverrides ?? {};

    const maxTlp = version.maxTlp as ReportTlp;
    const maxPap = version.maxPap as ReportPap;

    let built;
    try {
      built = await buildCaseReportForTemplate({
        organisationId: job.organisationId,
        caseId: job.caseId,
        sections,
        inclusionRules,
        overrides,
        maxTlp,
        maxPap,
      });
    } catch (error) {
      if (error instanceof CaseTlpCeilingError) {
        throw new Error(
          `Case classification ${classifyLabel(error.caseTlp)} exceeds template audience ceiling ${classifyLabel(error.maxTlp)}`,
        );
      }
      throw error;
    }
    if (!built) throw new Error("Case not found");

    const contentFingerprint = computeContentFingerprint({
      templateVersionId: version.id,
      templateVersionNumber: version.version,
      variant: template.variant as ReportVariant,
      maxTlp,
      maxPap,
      selectedSections: built.includedKeys,
      dataRevision: built.dataRevision,
      destination: "export_history",
      format: job.format,
    });

    const stamp: ReportStamp = {
      caseNumber: built.data.case.caseNumber,
      caseId: built.data.case.id,
      generatedAt: new Date().toISOString(),
      templateId: template.id,
      templateName: template.name,
      templateVersion: version.version,
      templateVersionId: version.id,
      variant: template.variant as ReportVariant,
      format: job.format as ReportExportFormat,
      generatedByUserId: job.requestedBy,
      sha256: null,
      contentFingerprint,
      dataRevision: built.dataRevision,
      maxTlp,
      maxPap,
    };

    let buffer: Buffer;
    let filename: string;
    if (job.format === "json") {
      const body = renderTemplatedJson(built, stamp);
      buffer = Buffer.from(body, "utf8");
      filename = `${built.data.case.caseNumber}-report.json`;
    } else {
      // PDF from filtered case data; stamp is also embedded via a small JSON
      // sidecar concept — for PDF we re-hash the bytes after render.
      buffer = await renderTemplatedPdf(built.data);
      filename = `${built.data.case.caseNumber}-report.pdf`;
    }

    const stored = await putFile(buffer, job.organisationId, filename);
    // Prefer storage-layer sha256; recompute for defence in depth.
    const digest = stored.sha256 || sha256Hex(buffer);

    const requireApproval = version.requireApproval;
    const nextStatus = requireApproval ? "awaiting_approval" : "completed";

    await db
      .update(reportExports)
      .set({
        status: nextStatus,
        storageKey: stored.key,
        sha256: digest,
        sizeBytes: stored.sizeBytes,
        contentFingerprint,
        dataRevision: built.dataRevision,
        selectedSections: built.includedKeys,
        redactionSummary: {
          maxTlp: built.redaction.maxTlp,
          maxPap: built.redaction.maxPap,
          includedCount: built.redaction.includedCount,
          excludedCount: built.redaction.excludedCount,
          maskedCount: built.redaction.maskedCount,
          items: built.redaction.items,
        },
        completedAt: new Date(),
        error: null,
      })
      .where(eq(reportExports.id, exportId));

    if (requireApproval) {
      await db.insert(reportExportApprovals).values({
        id: newId("rpaa"),
        exportId,
        organisationId: job.organisationId,
        status: "pending",
        boundContentFingerprint: contentFingerprint,
        boundTemplateVersionId: version.id,
        boundDataRevision: built.dataRevision,
        requestedBy: job.requestedBy,
      });
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? friendlyExportError(error.message)
        : "Report generation failed";
    await db
      .update(reportExports)
      .set({ status: "failed", error: message })
      .where(eq(reportExports.id, exportId));
  }
}

function friendlyExportError(raw: string): string {
  if (/exceeds template audience ceiling|Case classification|Case TLP exceeds/i.test(raw)) {
    return "This case's classification exceeds the template audience ceiling. Use a higher-TLP template or lower the case TLP.";
  }
  if (/not found/i.test(raw)) return "The case or template could not be found.";
  if (/template/i.test(raw)) return "The report template is no longer available.";
  if (/storage|ENOSPC|EACCES/i.test(raw)) {
    return "Kelpie could not store the generated report. Try again later.";
  }
  return "Report generation failed. Retry creates a new export without releasing the previous one.";
}

function mapBuildError(error: unknown): ReportExportError {
  if (error instanceof CaseTlpCeilingError) {
    return new ReportExportError(
      `Case classification ${classifyLabel(error.caseTlp)} exceeds template audience ceiling ${classifyLabel(error.maxTlp)}`,
      403,
    );
  }
  if (error instanceof ReportExportError) return error;
  if (error instanceof Error) {
    return new ReportExportError(error.message, 500);
  }
  return new ReportExportError("Report build failed", 500);
}

export async function listReportExportsCore(
  organisationId: string,
  caseId: string,
  limit = 50,
): Promise<ReportExport[]> {
  return db
    .select()
    .from(reportExports)
    .where(
      and(
        eq(reportExports.organisationId, organisationId),
        eq(reportExports.caseId, caseId),
      ),
    )
    .orderBy(desc(reportExports.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getReportExportCore(
  organisationId: string,
  exportId: string,
): Promise<ReportExport | null> {
  const [row] = await db
    .select()
    .from(reportExports)
    .where(
      and(
        eq(reportExports.id, exportId),
        eq(reportExports.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getReportExportApprovalCore(
  organisationId: string,
  exportId: string,
): Promise<ReportExportApproval | null> {
  const [row] = await db
    .select()
    .from(reportExportApprovals)
    .where(
      and(
        eq(reportExportApprovals.exportId, exportId),
        eq(reportExportApprovals.organisationId, organisationId),
        eq(reportExportApprovals.status, "pending"),
      ),
    )
    .orderBy(desc(reportExportApprovals.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Approve release. Re-validates bound fingerprint against current case data
 * and template version; invalidates if anything drifted.
 */
export async function approveReportExportCore(opts: {
  organisationId: string;
  exportId: string;
  actorId: string;
  decision: "approve" | "reject";
}): Promise<ReportExport> {
  const exp = await getReportExportCore(opts.organisationId, opts.exportId);
  if (!exp) throw new ReportExportError("Export not found", 404);
  if (exp.status !== "awaiting_approval") {
    throw new ReportExportError(
      "This export is not awaiting approval",
      409,
    );
  }

  const approval = await getReportExportApprovalCore(
    opts.organisationId,
    opts.exportId,
  );
  if (!approval) {
    throw new ReportExportError("No pending approval for this export", 409);
  }

  // Separation of duties: requester cannot approve their own release.
  if (
    opts.decision === "approve" &&
    approval.requestedBy &&
    approval.requestedBy === opts.actorId
  ) {
    throw new ReportExportError(
      "Approver cannot be the same user who requested this export",
      403,
    );
  }

  // Binding must still match the export snapshot.
  if (
    !exp.contentFingerprint ||
    !exp.dataRevision ||
    !exp.templateVersionId ||
    exp.contentFingerprint !== approval.boundContentFingerprint ||
    exp.dataRevision !== approval.boundDataRevision ||
    exp.templateVersionId !== approval.boundTemplateVersionId
  ) {
    await invalidateApproval(approval.id, "export_binding_mismatch");
    throw new ReportExportError(
      "Approval binding no longer matches this export; request a new export",
      409,
    );
  }

  // Live re-check: case data must not have moved since generation.
  if (!exp.templateVersionId) {
    throw new ReportExportError("Export is missing template version", 409);
  }
  const resolved = await getReportTemplateVersionById(
    opts.organisationId,
    exp.templateVersionId,
  );
  if (!resolved) {
    await invalidateApproval(approval.id, "template_version_missing");
    throw new ReportExportError(
      "Template version changed or was removed; request a new export",
      409,
    );
  }

  const { version } = resolved;
  const inclusionRules = normaliseInclusionRules(version.inclusionRules);
  const sections = normaliseSectionConfigs(version.sections);
  const pending = (exp.redactionSummary ?? {}) as {
    pendingOverrides?: SectionOverrideMap;
  };
  let built;
  try {
    built = await buildCaseReportForTemplate({
      organisationId: opts.organisationId,
      caseId: exp.caseId,
      sections,
      inclusionRules,
      overrides: pending.pendingOverrides ?? {},
      maxTlp: version.maxTlp as ReportTlp,
      maxPap: version.maxPap as ReportPap,
    });
  } catch (error) {
    throw mapBuildError(error);
  }
  if (!built) throw new ReportExportError("Case not found", 404);

  if (built.dataRevision !== approval.boundDataRevision) {
    await invalidateApproval(approval.id, "data_revision_changed");
    throw new ReportExportError(
      "Case data changed since generation; approval is invalid. Generate a new export.",
      409,
    );
  }

  // Template head must still be the bound version when approving release of
  // a version that was current at generation — historical version id is what
  // we bind; a newer head does not invalidate an export of an older version.
  if (version.id !== approval.boundTemplateVersionId) {
    await invalidateApproval(approval.id, "template_version_changed");
    throw new ReportExportError(
      "Template version binding failed; request a new export",
      409,
    );
  }

  if (opts.decision === "reject") {
    await db
      .update(reportExportApprovals)
      .set({
        status: "rejected",
        decidedBy: opts.actorId,
        decidedAt: new Date(),
      })
      .where(eq(reportExportApprovals.id, approval.id));
    await db
      .update(reportExports)
      .set({ status: "failed", error: "Release rejected by approver" })
      .where(eq(reportExports.id, opts.exportId));
  } else {
    await db
      .update(reportExportApprovals)
      .set({
        status: "approved",
        decidedBy: opts.actorId,
        decidedAt: new Date(),
      })
      .where(eq(reportExportApprovals.id, approval.id));
    await db
      .update(reportExports)
      .set({
        status: "released",
        releasedBy: opts.actorId,
        releasedAt: new Date(),
      })
      .where(eq(reportExports.id, opts.exportId));
  }

  const updated = await getReportExportCore(opts.organisationId, opts.exportId);
  if (!updated) throw new ReportExportError("Export not found", 404);
  return updated;
}

async function invalidateApproval(approvalId: string, reason: string) {
  await db
    .update(reportExportApprovals)
    .set({
      status: "invalidated",
      invalidateReason: reason,
      decidedAt: new Date(),
    })
    .where(eq(reportExportApprovals.id, approvalId));
}

export type DownloadResult = {
  buffer: Buffer;
  filename: string;
  contentType: string;
  sha256: string;
  export: ReportExport;
};

export async function downloadReportExportCore(
  organisationId: string,
  exportId: string,
): Promise<DownloadResult> {
  const exp = await getReportExportCore(organisationId, exportId);
  if (!exp || !DOWNLOADABLE.has(exp.status) || !exp.storageKey) {
    throw new ReportExportError("Export not available for download", 404);
  }
  // Defence in depth: refuse path traversal / cross-tenant storage keys.
  const expectedPrefix = `${organisationId}/`;
  if (!exp.storageKey.startsWith(expectedPrefix)) {
    throw new ReportExportError("Export not available for download", 404);
  }
  const buffer = await readFile(exp.storageKey);
  // Integrity check
  if (exp.sha256) {
    const digest = sha256Hex(buffer);
    if (digest !== exp.sha256) {
      throw new ReportExportError(
        "Stored report failed integrity check",
        409,
      );
    }
  }
  const ext = exp.format === "json" ? "json" : "pdf";
  const contentType =
    exp.format === "json" ? "application/json" : "application/pdf";
  return {
    buffer,
    filename: `report-${exp.id}.${ext}`,
    contentType,
    sha256: exp.sha256 ?? sha256Hex(buffer),
    export: exp,
  };
}

/** Public safe view — never includes storageKey. */
export function toPublicExport(row: ReportExport) {
  const { storageKey: _storageKey, ...safe } = row;
  return safe;
}

// ── Schedules (permission re-check at run) ────────────────────────────────

export async function createReportScheduleCore(opts: {
  organisationId: string;
  templateId: string;
  caseId: string;
  format: ReportExportFormat;
  intervalMinutes?: number;
  overrides?: SectionOverrideMap;
  createdBy: string | null;
}): Promise<typeof reportSchedules.$inferSelect> {
  if (!(await caseExistsInOrg(opts.organisationId, opts.caseId))) {
    throw new ReportExportError("Case not found", 404);
  }
  const template = await getReportTemplateCore(
    opts.organisationId,
    opts.templateId,
  );
  if (!template || !template.isActive) {
    throw new ReportExportError("Report template not found", 404);
  }
  const interval = Math.max(opts.intervalMinutes ?? 1440, 60);
  const id = newId("rpsch");
  const nextRunAt = new Date(Date.now() + interval * 60_000);
  await db.insert(reportSchedules).values({
    id,
    organisationId: opts.organisationId,
    templateId: opts.templateId,
    caseId: opts.caseId,
    format: opts.format,
    destinationPolicy: { kind: "export_history" },
    sectionOverrides: opts.overrides ?? {},
    intervalMinutes: interval,
    isActive: true,
    nextRunAt,
    createdBy: opts.createdBy,
  });
  const [row] = await db
    .select()
    .from(reportSchedules)
    .where(eq(reportSchedules.id, id))
    .limit(1);
  if (!row) throw new ReportExportError("Failed to create schedule", 500);
  return row;
}

/**
 * Run due schedules. Re-checks at run time (fail closed):
 * - creator still active in org, not banned/locked
 * - creator still has reports:write equivalent (admin or analyst)
 * - template still active
 * - case still accessible in org
 * Never trusts schedule-time grants alone.
 */
export async function processDueReportSchedules(limit = 20): Promise<{
  ran: number;
  failed: number;
}> {
  const now = new Date();
  const due = await db
    .select()
    .from(reportSchedules)
    .where(
      and(
        eq(reportSchedules.isActive, true),
        // nextRunAt <= now — use raw comparison via SQL-less filter after fetch
      ),
    )
    .orderBy(reportSchedules.nextRunAt)
    .limit(limit * 2);

  const ready = due.filter((s) => s.nextRunAt <= now).slice(0, limit);
  let ran = 0;
  let failed = 0;

  for (const schedule of ready) {
    try {
      if (!schedule.caseId) {
        throw new Error("Schedule is missing caseId");
      }

      await assertScheduleCreatorMayRun(
        schedule.organisationId,
        schedule.createdBy,
      );

      // Re-check template + case
      const template = await getReportTemplateCore(
        schedule.organisationId,
        schedule.templateId,
      );
      if (!template || !template.isActive) {
        throw new Error("Template inactive or missing");
      }
      if (
        !(await caseExistsInOrg(schedule.organisationId, schedule.caseId))
      ) {
        throw new Error("Case no longer available");
      }

      const exp = await createReportExportCore({
        organisationId: schedule.organisationId,
        caseId: schedule.caseId,
        templateId: schedule.templateId,
        format: schedule.format as ReportExportFormat,
        overrides: (schedule.sectionOverrides ?? {}) as SectionOverrideMap,
        requestedBy: schedule.createdBy,
        scheduleId: schedule.id,
        processInline: true,
      });

      await db
        .update(reportSchedules)
        .set({
          lastRunAt: now,
          lastExportId: exp.id,
          lastError: null,
          nextRunAt: new Date(
            now.getTime() + schedule.intervalMinutes * 60_000,
          ),
          updatedAt: new Date(),
        })
        .where(eq(reportSchedules.id, schedule.id));
      ran += 1;
    } catch (error) {
      failed += 1;
      await db
        .update(reportSchedules)
        .set({
          lastError:
            error instanceof Error
              ? error.message
              : "Scheduled report failed",
          nextRunAt: new Date(
            now.getTime() + schedule.intervalMinutes * 60_000,
          ),
          updatedAt: new Date(),
        })
        .where(eq(reportSchedules.id, schedule.id));
    }
  }

  return { ran, failed };
}

/**
 * Session-user equivalent of reports:write at schedule run time.
 * API tokens use scopes; scheduled runs are attributed to a user creator.
 * Fail closed if creator is missing, left the org, banned/locked, or
 * demoted to read_only.
 */
async function assertScheduleCreatorMayRun(
  organisationId: string,
  creatorId: string | null,
): Promise<void> {
  if (!creatorId) {
    throw new Error("Schedule creator is missing");
  }
  const [user] = await db
    .select({
      id: users.id,
      role: users.role,
      banned: users.banned,
      lockedAt: users.lockedAt,
      organisationId: users.organisationId,
    })
    .from(users)
    .where(eq(users.id, creatorId))
    .limit(1);

  if (!user || user.organisationId !== organisationId) {
    throw new Error("Schedule creator is no longer in organisation");
  }
  if (user.banned || user.lockedAt) {
    throw new Error("Schedule creator is inactive");
  }
  // reports:write for users: admin or analyst (not read_only)
  if (user.role !== "admin" && user.role !== "analyst") {
    throw new Error("Schedule creator lacks reports:write permission");
  }
}
