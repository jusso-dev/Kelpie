/**
 * Pure section selection for report templates (issue #47).
 * Resolves required / default / override / force-exclude into an ordered list.
 */

import {
  humaniseSectionKey,
  type ReportSectionConfig,
  type ReportInclusionRules,
  type ReportSectionKey,
  type SectionOverrideMap,
  type SelectedSection,
  isReportSectionKey,
} from "./types";

export class ReportSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportSelectionError";
  }
}

/** Validate and normalise raw section configs from JSON storage. */
export function normaliseSectionConfigs(raw: unknown): ReportSectionConfig[] {
  if (!Array.isArray(raw)) {
    throw new ReportSelectionError("Template sections must be an array");
  }
  const seen = new Set<string>();
  const out: ReportSectionConfig[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      throw new ReportSelectionError("Each section must be an object");
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.key !== "string" || !isReportSectionKey(e.key)) {
      throw new ReportSelectionError(`Unknown section key: ${String(e.key)}`);
    }
    if (seen.has(e.key)) {
      throw new ReportSelectionError(`Duplicate section key: ${e.key}`);
    }
    seen.add(e.key);
    out.push({
      key: e.key,
      title: typeof e.title === "string" && e.title.trim() ? e.title.trim() : undefined,
      required: Boolean(e.required),
      defaultIncluded: e.defaultIncluded !== false,
      order: typeof e.order === "number" && Number.isFinite(e.order) ? e.order : out.length,
    });
  }
  return out.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

export function normaliseInclusionRules(raw: unknown): ReportInclusionRules {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ReportSelectionError("inclusionRules must be an object");
  }
  const r = raw as Record<string, unknown>;
  const rules: ReportInclusionRules = {};
  if (typeof r.maxTlp === "string") rules.maxTlp = r.maxTlp as ReportInclusionRules["maxTlp"];
  if (typeof r.maxPap === "string") rules.maxPap = r.maxPap as ReportInclusionRules["maxPap"];
  if (typeof r.maskOverTlp === "boolean") rules.maskOverTlp = r.maskOverTlp;
  if (typeof r.includeSensitiveBlocks === "boolean") {
    rules.includeSensitiveBlocks = r.includeSensitiveBlocks;
  }
  if (Array.isArray(r.forceExclude)) {
    rules.forceExclude = r.forceExclude.filter(
      (k): k is ReportSectionKey => typeof k === "string" && isReportSectionKey(k),
    );
  }
  return rules;
}

/**
 * Resolve which sections are included for this generation/preview.
 * Required sections cannot be opted out. forceExclude wins over everything.
 */
export function selectSections(
  sections: ReportSectionConfig[],
  rules: ReportInclusionRules,
  overrides: SectionOverrideMap = {},
): SelectedSection[] {
  const force = new Set(rules.forceExclude ?? []);
  const ordered = [...sections].sort(
    (a, b) => a.order - b.order || a.key.localeCompare(b.key),
  );

  return ordered.map((section) => {
    const title = section.title ?? humaniseSectionKey(section.key);
    if (force.has(section.key)) {
      return {
        key: section.key,
        title,
        required: section.required,
        included: false,
        reason: "force_exclude" as const,
      };
    }
    if (section.required) {
      return {
        key: section.key,
        title,
        required: true,
        included: true,
        reason: "required" as const,
      };
    }
    const override = overrides[section.key];
    if (override === true) {
      return {
        key: section.key,
        title,
        required: false,
        included: true,
        reason: "override_on" as const,
      };
    }
    if (override === false) {
      return {
        key: section.key,
        title,
        required: false,
        included: false,
        reason: "override_off" as const,
      };
    }
    return {
      key: section.key,
      title,
      required: false,
      included: section.defaultIncluded,
      reason: "default" as const,
    };
  });
}

export function includedSectionKeys(selected: SelectedSection[]): ReportSectionKey[] {
  return selected.filter((s) => s.included).map((s) => s.key);
}
