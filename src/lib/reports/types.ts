/**
 * Controlled case report templates (issue #47).
 *
 * Types shared by selection, redaction, preview, generation, and approval.
 * No executable template code — sections are declarative keys only.
 */

export const REPORT_VARIANTS = [
  "executive",
  "technical",
  "regulatory",
  "post_incident",
] as const;
export type ReportVariant = (typeof REPORT_VARIANTS)[number];

export const REPORT_SECTION_KEYS = [
  "summary",
  "metadata",
  "tasks",
  "observables",
  "timeline",
  "comments",
  "evidence_inventory",
  "ttp_mappings",
  "attack_story",
  "related_cases",
  "custom_fields",
  "investigation_blocks",
  "post_incident_review",
  "closure",
] as const;
export type ReportSectionKey = (typeof REPORT_SECTION_KEYS)[number];

export const REPORT_EXPORT_FORMATS = ["pdf", "json"] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export const REPORT_TLP_ORDER = [
  "clear",
  "green",
  "amber",
  "amber_strict",
  "red",
] as const;
export type ReportTlp = (typeof REPORT_TLP_ORDER)[number];

export const REPORT_PAP_ORDER = ["clear", "green", "amber", "red"] as const;
export type ReportPap = (typeof REPORT_PAP_ORDER)[number];

/** One ordered section in a template version. */
export type ReportSectionConfig = {
  key: ReportSectionKey;
  /** Display title override; defaults to humanised key. */
  title?: string;
  /** When false, analyst may opt in; when true, always included if selected by rules. */
  required: boolean;
  /** Default inclusion when the analyst does not override. */
  defaultIncluded: boolean;
  order: number;
};

/**
 * Audience / classification ceiling for a template version.
 * Content above maxTlp/maxPap is excluded or masked — never leaked in preview.
 */
export type ReportInclusionRules = {
  maxTlp?: ReportTlp;
  maxPap?: ReportPap;
  /** When true, mask observable values that exceed maxTlp rather than dropping the row. */
  maskOverTlp?: boolean;
  /** When true, include sensitive content blocks (still subject to TLP/PAP). */
  includeSensitiveBlocks?: boolean;
  /** Optional hard-exclude section keys regardless of template defaults. */
  forceExclude?: ReportSectionKey[];
};

export type SectionOverrideMap = Partial<Record<ReportSectionKey, boolean>>;

export type SelectedSection = {
  key: ReportSectionKey;
  title: string;
  required: boolean;
  included: boolean;
  reason: "required" | "default" | "override_on" | "override_off" | "force_exclude";
};

export type RedactionItemStatus = "included" | "excluded" | "masked";

/**
 * Redaction preview item. For excluded/masked items, `label` is a safe
 * descriptor that must never contain the hidden raw value.
 */
export type RedactionPreviewItem = {
  section: ReportSectionKey;
  itemId: string;
  label: string;
  status: RedactionItemStatus;
  /** Why the item was excluded or masked (classification label, never raw content). */
  reason?: string;
  classification?: {
    tlp?: string;
    pap?: string;
    sensitive?: boolean;
  };
};

export type RedactionPreview = {
  maxTlp: ReportTlp;
  maxPap: ReportPap;
  includedCount: number;
  excludedCount: number;
  maskedCount: number;
  items: RedactionPreviewItem[];
};

export type ReportStamp = {
  caseNumber: string;
  caseId: string;
  generatedAt: string;
  templateId: string | null;
  templateName: string | null;
  templateVersion: number;
  templateVersionId: string | null;
  variant: ReportVariant;
  format: ReportExportFormat;
  generatedByUserId: string | null;
  sha256: string | null;
  contentFingerprint: string;
  dataRevision: string;
  maxTlp: ReportTlp;
  maxPap: ReportPap;
};

export function isReportVariant(value: string): value is ReportVariant {
  return (REPORT_VARIANTS as readonly string[]).includes(value);
}

export function isReportSectionKey(value: string): value is ReportSectionKey {
  return (REPORT_SECTION_KEYS as readonly string[]).includes(value);
}

export function isReportExportFormat(value: string): value is ReportExportFormat {
  return (REPORT_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function isReportTlp(value: string): value is ReportTlp {
  return (REPORT_TLP_ORDER as readonly string[]).includes(value);
}

export function isReportPap(value: string): value is ReportPap {
  return (REPORT_PAP_ORDER as readonly string[]).includes(value);
}

export function humaniseSectionKey(key: ReportSectionKey): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function tlpRank(tlp: string): number {
  const idx = (REPORT_TLP_ORDER as readonly string[]).indexOf(tlp);
  return idx < 0 ? REPORT_TLP_ORDER.length : idx;
}

export function papRank(pap: string): number {
  const idx = (REPORT_PAP_ORDER as readonly string[]).indexOf(pap);
  return idx < 0 ? REPORT_PAP_ORDER.length : idx;
}

/** True when classification is at or below the allowed ceiling. */
export function withinTlpCeiling(value: string, maxTlp: ReportTlp): boolean {
  return tlpRank(value) <= tlpRank(maxTlp);
}

export function withinPapCeiling(value: string, maxPap: ReportPap): boolean {
  return papRank(value) <= papRank(maxPap);
}

export function classifyLabel(tlp: string): string {
  return `TLP:${tlp.replace("_", "+").toUpperCase()}`;
}

export function classifyPapLabel(pap: string): string {
  return `PAP:${pap.toUpperCase()}`;
}
