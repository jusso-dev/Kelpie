/**
 * Content fingerprints and data revisions for report approval binding (issue #47).
 *
 * Approval is invalidated when selected content, data revision, template
 * version, audience (max TLP/PAP/variant), or destination changes.
 */

import crypto from "node:crypto";
import type { ReportPap, ReportSectionKey, ReportTlp, ReportVariant } from "./types";

export type ApprovalBindInput = {
  templateVersionId: string;
  templateVersionNumber: number;
  variant: ReportVariant;
  maxTlp: ReportTlp;
  maxPap: ReportPap;
  selectedSections: ReportSectionKey[];
  dataRevision: string;
  /** Destination policy kind, e.g. "export_history". */
  destination: string;
  format: string;
};

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Stable fingerprint bound into the approval record. */
export function computeContentFingerprint(input: ApprovalBindInput): string {
  const payload = {
    templateVersionId: input.templateVersionId,
    templateVersionNumber: input.templateVersionNumber,
    variant: input.variant,
    maxTlp: input.maxTlp,
    maxPap: input.maxPap,
    selectedSections: [...input.selectedSections].sort(),
    dataRevision: input.dataRevision,
    destination: input.destination,
    format: input.format,
  };
  return sha256Hex(JSON.stringify(payload));
}

/**
 * Opaque revision stamp of case data. Callers pass already-collected markers
 * (updatedAt, counts, max block revision) so this stays pure and testable.
 */
export function computeDataRevision(markers: {
  caseId: string;
  caseUpdatedAt: string | Date;
  caseVersion?: number;
  observableCount: number;
  taskCount: number;
  commentCount: number;
  timelineCount: number;
  contentBlockRevisionSum: number;
  evidenceCount: number;
  mappingCount: number;
}): string {
  const payload = {
    caseId: markers.caseId,
    caseUpdatedAt:
      markers.caseUpdatedAt instanceof Date
        ? markers.caseUpdatedAt.toISOString()
        : markers.caseUpdatedAt,
    caseVersion: markers.caseVersion ?? 0,
    observableCount: markers.observableCount,
    taskCount: markers.taskCount,
    commentCount: markers.commentCount,
    timelineCount: markers.timelineCount,
    contentBlockRevisionSum: markers.contentBlockRevisionSum,
    evidenceCount: markers.evidenceCount,
    mappingCount: markers.mappingCount,
  };
  return sha256Hex(JSON.stringify(payload));
}

/**
 * True when an approval's bound fields still match the export (no invalidation).
 */
export function approvalStillValid(opts: {
  boundContentFingerprint: string;
  boundTemplateVersionId: string;
  boundDataRevision: string;
  currentContentFingerprint: string;
  currentTemplateVersionId: string;
  currentDataRevision: string;
}): boolean {
  return (
    opts.boundContentFingerprint === opts.currentContentFingerprint &&
    opts.boundTemplateVersionId === opts.currentTemplateVersionId &&
    opts.boundDataRevision === opts.currentDataRevision
  );
}

export type InvalidationReason =
  | "content_fingerprint_changed"
  | "template_version_changed"
  | "data_revision_changed"
  | "multiple";

export function explainInvalidation(opts: {
  boundContentFingerprint: string;
  boundTemplateVersionId: string;
  boundDataRevision: string;
  currentContentFingerprint: string;
  currentTemplateVersionId: string;
  currentDataRevision: string;
}): InvalidationReason | null {
  const fp = opts.boundContentFingerprint !== opts.currentContentFingerprint;
  const tv = opts.boundTemplateVersionId !== opts.currentTemplateVersionId;
  const dr = opts.boundDataRevision !== opts.currentDataRevision;
  const count = [fp, tv, dr].filter(Boolean).length;
  if (count === 0) return null;
  if (count > 1) return "multiple";
  if (fp) return "content_fingerprint_changed";
  if (tv) return "template_version_changed";
  return "data_revision_changed";
}
