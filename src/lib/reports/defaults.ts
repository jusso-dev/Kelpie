/**
 * Default report templates seeded per organisation (issue #47).
 * Executive, technical incident, and post-incident variants.
 */

import type { ReportInclusionRules, ReportSectionConfig, ReportVariant } from "./types";

export const REPORT_CATALOGUE_VERSION = 1;

export type BaselineReportTemplate = {
  key: string;
  name: string;
  description: string;
  variant: ReportVariant;
  requireApproval: boolean;
  maxTlp: ReportInclusionRules["maxTlp"];
  maxPap: ReportInclusionRules["maxPap"];
  inclusionRules: ReportInclusionRules;
  sections: Omit<ReportSectionConfig, "order">[];
};

function withOrder(
  sections: Omit<ReportSectionConfig, "order">[],
): ReportSectionConfig[] {
  return sections.map((s, i) => ({ ...s, order: i }));
}

const EXECUTIVE_SECTIONS: Omit<ReportSectionConfig, "order">[] = [
  { key: "metadata", required: true, defaultIncluded: true },
  { key: "summary", required: true, defaultIncluded: true },
  { key: "closure", required: false, defaultIncluded: true },
  { key: "post_incident_review", required: false, defaultIncluded: false },
  { key: "tasks", required: false, defaultIncluded: false },
  { key: "observables", required: false, defaultIncluded: false },
  { key: "timeline", required: false, defaultIncluded: false },
  { key: "investigation_blocks", required: false, defaultIncluded: true },
];

const TECHNICAL_SECTIONS: Omit<ReportSectionConfig, "order">[] = [
  { key: "metadata", required: true, defaultIncluded: true },
  { key: "summary", required: true, defaultIncluded: true },
  { key: "observables", required: false, defaultIncluded: true },
  { key: "ttp_mappings", required: false, defaultIncluded: true },
  { key: "attack_story", required: false, defaultIncluded: true },
  { key: "investigation_blocks", required: false, defaultIncluded: true },
  { key: "tasks", required: false, defaultIncluded: true },
  { key: "timeline", required: false, defaultIncluded: true },
  { key: "evidence_inventory", required: false, defaultIncluded: true },
  { key: "comments", required: false, defaultIncluded: false },
  { key: "related_cases", required: false, defaultIncluded: true },
  { key: "custom_fields", required: false, defaultIncluded: true },
  { key: "closure", required: false, defaultIncluded: true },
];

const POST_INCIDENT_SECTIONS: Omit<ReportSectionConfig, "order">[] = [
  { key: "metadata", required: true, defaultIncluded: true },
  { key: "summary", required: true, defaultIncluded: true },
  { key: "timeline", required: false, defaultIncluded: true },
  { key: "ttp_mappings", required: false, defaultIncluded: true },
  { key: "investigation_blocks", required: false, defaultIncluded: true },
  { key: "tasks", required: false, defaultIncluded: true },
  { key: "closure", required: true, defaultIncluded: true },
  { key: "post_incident_review", required: true, defaultIncluded: true },
  { key: "evidence_inventory", required: false, defaultIncluded: false },
  { key: "observables", required: false, defaultIncluded: false },
];

/** Regulatory default — fuller retention of metadata and inventory. */
const REGULATORY_SECTIONS: Omit<ReportSectionConfig, "order">[] = [
  { key: "metadata", required: true, defaultIncluded: true },
  { key: "summary", required: true, defaultIncluded: true },
  { key: "timeline", required: true, defaultIncluded: true },
  { key: "observables", required: false, defaultIncluded: true },
  { key: "evidence_inventory", required: false, defaultIncluded: true },
  { key: "tasks", required: false, defaultIncluded: true },
  { key: "ttp_mappings", required: false, defaultIncluded: true },
  { key: "investigation_blocks", required: false, defaultIncluded: true },
  { key: "custom_fields", required: false, defaultIncluded: true },
  { key: "closure", required: false, defaultIncluded: true },
  { key: "related_cases", required: false, defaultIncluded: true },
];

export const BASELINE_REPORT_TEMPLATES: BaselineReportTemplate[] = [
  {
    key: "executive_summary",
    name: "Executive summary",
    description:
      "Audience-appropriate high-level incident summary for leadership. Defaults to TLP:AMBER ceiling with optional observables.",
    variant: "executive",
    requireApproval: true,
    maxTlp: "amber",
    maxPap: "amber",
    inclusionRules: {
      maxTlp: "amber",
      maxPap: "amber",
      maskOverTlp: true,
      includeSensitiveBlocks: false,
    },
    sections: EXECUTIVE_SECTIONS,
  },
  {
    key: "technical_incident",
    name: "Technical incident report",
    description:
      "Full technical investigation report including observables, ATT&CK mappings, timeline, and evidence inventory.",
    variant: "technical",
    requireApproval: false,
    maxTlp: "red",
    maxPap: "red",
    inclusionRules: {
      maxTlp: "red",
      maxPap: "red",
      maskOverTlp: false,
      includeSensitiveBlocks: false,
    },
    sections: TECHNICAL_SECTIONS,
  },
  {
    key: "post_incident_review",
    name: "Post-incident review",
    description:
      "Post-incident report emphasising timeline, closure disposition, root cause, impact, and lessons learned.",
    variant: "post_incident",
    requireApproval: true,
    maxTlp: "amber",
    maxPap: "amber",
    inclusionRules: {
      maxTlp: "amber",
      maxPap: "amber",
      maskOverTlp: true,
      includeSensitiveBlocks: false,
    },
    sections: POST_INCIDENT_SECTIONS,
  },
  {
    key: "regulatory_export",
    name: "Regulatory export",
    description:
      "Structured export for regulatory or external audit consumers. Requires release approval.",
    variant: "regulatory",
    requireApproval: true,
    maxTlp: "amber_strict",
    maxPap: "amber",
    inclusionRules: {
      maxTlp: "amber_strict",
      maxPap: "amber",
      maskOverTlp: true,
      includeSensitiveBlocks: false,
    },
    sections: REGULATORY_SECTIONS,
  },
];

export function baselineSections(template: BaselineReportTemplate): ReportSectionConfig[] {
  return withOrder(template.sections);
}
