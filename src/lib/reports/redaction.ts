/**
 * Classification-aware redaction for report preview/generation (issue #47).
 *
 * Rules:
 * - Redaction preview never reveals hidden content to the previewing user.
 * - Excluded/masked labels are safe descriptors (ids + classification), not raw values.
 * - Preview status must match what generation will include/mask/exclude.
 */

import {
  classifyLabel,
  classifyPapLabel,
  type RedactionPreview,
  type RedactionPreviewItem,
  type ReportPap,
  type ReportSectionKey,
  type ReportTlp,
  withinPapCeiling,
  withinTlpCeiling,
} from "./types";

export type ClassifiedItem = {
  id: string;
  /** Safe display label when included (may be the value for low-TLP items). */
  safeLabel: string;
  tlp?: string;
  pap?: string;
  sensitive?: boolean;
  section: ReportSectionKey;
};

export type RedactionOptions = {
  maxTlp: ReportTlp;
  maxPap: ReportPap;
  /** Mask over-ceiling items instead of dropping them (observables). */
  maskOverTlp?: boolean;
  includeSensitive?: boolean;
};

/**
 * Decide include / exclude / mask for one classified item.
 * Never returns the raw value in excluded/masked labels.
 */
export function classifyItem(
  item: ClassifiedItem,
  opts: RedactionOptions,
): RedactionPreviewItem {
  const classification = {
    tlp: item.tlp,
    pap: item.pap,
    sensitive: item.sensitive,
  };

  if (item.sensitive && !opts.includeSensitive) {
    return {
      section: item.section,
      itemId: item.id,
      label: safeHiddenLabel(item),
      status: "excluded",
      reason: "sensitive content excluded for this audience",
      classification,
    };
  }

  if (item.tlp && !withinTlpCeiling(item.tlp, opts.maxTlp)) {
    if (opts.maskOverTlp) {
      return {
        section: item.section,
        itemId: item.id,
        label: safeHiddenLabel(item),
        status: "masked",
        reason: `${classifyLabel(item.tlp)} exceeds audience ceiling ${classifyLabel(opts.maxTlp)}`,
        classification,
      };
    }
    return {
      section: item.section,
      itemId: item.id,
      label: safeHiddenLabel(item),
      status: "excluded",
      reason: `${classifyLabel(item.tlp)} exceeds audience ceiling ${classifyLabel(opts.maxTlp)}`,
      classification,
    };
  }

  if (item.pap && !withinPapCeiling(item.pap, opts.maxPap)) {
    return {
      section: item.section,
      itemId: item.id,
      label: safeHiddenLabel(item),
      status: "excluded",
      reason: `${classifyPapLabel(item.pap)} exceeds audience ceiling ${classifyPapLabel(opts.maxPap)}`,
      classification,
    };
  }

  return {
    section: item.section,
    itemId: item.id,
    label: item.safeLabel,
    status: "included",
    classification,
  };
}

/** Descriptor that never embeds the raw sensitive/over-ceiling value. */
function safeHiddenLabel(item: ClassifiedItem): string {
  const parts = [item.section.replace(/_/g, " "), item.id.slice(0, 12)];
  if (item.tlp) parts.push(classifyLabel(item.tlp));
  if (item.pap) parts.push(classifyPapLabel(item.pap));
  if (item.sensitive) parts.push("sensitive");
  return parts.join(" · ");
}

export function buildRedactionPreview(
  items: ClassifiedItem[],
  opts: RedactionOptions,
): RedactionPreview {
  const classified = items.map((item) => classifyItem(item, opts));
  let includedCount = 0;
  let excludedCount = 0;
  let maskedCount = 0;
  for (const c of classified) {
    if (c.status === "included") includedCount += 1;
    else if (c.status === "excluded") excludedCount += 1;
    else maskedCount += 1;
  }
  return {
    maxTlp: opts.maxTlp,
    maxPap: opts.maxPap,
    includedCount,
    excludedCount,
    maskedCount,
    items: classified,
  };
}

/**
 * Assert a redaction preview does not leak likely raw secret-ish values.
 * Used by tests; generation path uses the same classifyItem labels.
 */
export function previewLeaksRawValue(
  preview: RedactionPreview,
  rawValues: string[],
): string | null {
  for (const item of preview.items) {
    if (item.status === "included") continue;
    for (const raw of rawValues) {
      if (!raw || raw.length < 3) continue;
      if (item.label.includes(raw) || (item.reason && item.reason.includes(raw))) {
        return raw;
      }
    }
  }
  return null;
}

/** Mask a value for inclusion in generated output (never the raw value). */
export function maskValue(tlp: string | undefined, maxTlp: ReportTlp): string {
  const label = tlp ? classifyLabel(tlp) : "CLASSIFIED";
  return `[REDACTED — ${label} exceeds ${classifyLabel(maxTlp)}]`;
}
