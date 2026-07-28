/**
 * Build a filtered, redacted CaseReportData for template-driven export (issue #47).
 * Reuses loadCaseReport and applies section selection + TLP/PAP redaction.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cases, customFieldDefinitions, customFieldValues } from "@/db/schema";
import { listRelationshipsCore } from "@/lib/case-relationships-core";
import { listEvidenceForCase } from "@/lib/evidence/core";
import { loadCaseReport, type CaseReportData } from "@/lib/report";
import {
  buildRedactionPreview,
  maskValue,
  redactTimelineEvents,
  type ClassifiedItem,
} from "./redaction";
import { computeDataRevision } from "./fingerprint";
import { includedSectionKeys, selectSections } from "./selection";
import { sanitizeReportText } from "./sanitize";
import type {
  RedactionItemStatus,
  RedactionPreview,
  ReportInclusionRules,
  ReportPap,
  ReportSectionConfig,
  ReportSectionKey,
  ReportTlp,
  SectionOverrideMap,
  SelectedSection,
} from "./types";
import { withinTlpCeiling } from "./types";

export type BuiltReport = {
  data: CaseReportData;
  selected: SelectedSection[];
  includedKeys: ReportSectionKey[];
  redaction: RedactionPreview;
  dataRevision: string;
  evidenceInventory: Array<{
    id: string;
    filename: string;
    status: string;
    contentType: string | null;
    sizeBytes: number;
    sha256: string | null;
    relevance: string | null;
  }>;
  relatedCases: Array<{
    id: string;
    caseNumber: string;
    title: string;
    relationshipType: string;
  }>;
  customFields: Array<{ key: string; label: string; value: unknown }>;
  maxTlp: ReportTlp;
  maxPap: ReportPap;
};

export class CaseTlpCeilingError extends Error {
  readonly caseTlp: string;
  readonly maxTlp: ReportTlp;
  constructor(caseTlp: string, maxTlp: ReportTlp) {
    super(
      `Case TLP exceeds template audience ceiling (case=${caseTlp}, max=${maxTlp})`,
    );
    this.name = "CaseTlpCeilingError";
    this.caseTlp = caseTlp;
    this.maxTlp = maxTlp;
  }
}

export async function buildCaseReportForTemplate(opts: {
  organisationId: string;
  caseId: string;
  sections: ReportSectionConfig[];
  inclusionRules: ReportInclusionRules;
  overrides?: SectionOverrideMap;
  maxTlp: ReportTlp;
  maxPap: ReportPap;
}): Promise<BuiltReport | null> {
  const raw = await loadCaseReport(opts.organisationId, opts.caseId);
  if (!raw) return null;

  const maxTlp = opts.maxTlp;
  const maxPap = opts.maxPap;

  // Case-level TLP is a hard ceiling: never ship a redder case under a
  // lower-audience template (e.g. TLP:RED case with amber executive).
  if (!withinTlpCeiling(raw.case.tlp, maxTlp)) {
    throw new CaseTlpCeilingError(raw.case.tlp, maxTlp);
  }

  const selected = selectSections(
    opts.sections,
    opts.inclusionRules,
    opts.overrides ?? {},
  );
  const includedKeys = includedSectionKeys(selected);
  const includeSet = new Set(includedKeys);

  const maskOverTlp = opts.inclusionRules.maskOverTlp !== false;
  const includeSensitive = Boolean(opts.inclusionRules.includeSensitiveBlocks);

  const classified: ClassifiedItem[] = [];

  // Observables
  for (const o of raw.observables) {
    classified.push({
      id: o.id,
      safeLabel: `${o.type}: ${o.value}`,
      tlp: o.tlp,
      section: "observables",
    });
  }

  // Content blocks
  for (const b of raw.contentBlocks) {
    classified.push({
      id: b.id,
      safeLabel: b.title,
      tlp: b.tlp,
      pap: b.pap,
      sensitive: b.sensitive,
      section: "investigation_blocks",
    });
  }

  // Comments (no per-item TLP — treated as included when section is on)
  for (const c of raw.comments) {
    classified.push({
      id: c.id,
      safeLabel: `comment ${c.id.slice(0, 8)}`,
      section: "comments",
    });
  }

  const redaction = buildRedactionPreview(classified, {
    maxTlp,
    maxPap,
    maskOverTlp,
    includeSensitive,
  });

  const statusById = new Map(redaction.items.map((i) => [i.itemId, i]));

  const observables = includeSet.has("observables")
    ? raw.observables
        .map((o) => {
          const st = statusById.get(o.id);
          if (!st || st.status === "excluded") return null;
          if (st.status === "masked") {
            return {
              ...o,
              value: maskValue(o.tlp, maxTlp),
              description: null,
            };
          }
          return o;
        })
        .filter((o): o is NonNullable<typeof o> => o !== null)
    : [];

  const contentBlocks = includeSet.has("investigation_blocks")
    ? raw.contentBlocks
        .filter((b) => {
          const st = statusById.get(b.id);
          return st?.status === "included";
        })
        .map((b) => ({
          ...b,
          title: sanitizeReportText(b.title),
          content: sanitizeReportText(b.content),
        }))
    : [];

  const comments = includeSet.has("comments")
    ? raw.comments
        .filter((c) => statusById.get(c.id)?.status === "included")
        .map((c) => ({
          ...c,
          body: sanitizeReportText(c.body),
        }))
    : [];

  const tasks = includeSet.has("tasks") ? raw.tasks : [];

  // Timeline: same TLP mask as observables so observable_added values
  // cannot bypass redaction via MD/PDF/JSON payload dumps.
  let timeline: BuiltReport["data"]["timeline"] = [];
  if (includeSet.has("timeline")) {
    const statusByObservableId = new Map<string, RedactionItemStatus>();
    const tlpByObservableId = new Map<string, string>();
    const statusByValue = new Map<string, RedactionItemStatus>();
    const tlpByValue = new Map<string, string>();
    for (const o of raw.observables) {
      const st = statusById.get(o.id);
      if (!st) continue;
      statusByObservableId.set(o.id, st.status);
      tlpByObservableId.set(o.id, o.tlp);
      statusByValue.set(o.value, st.status);
      tlpByValue.set(o.value, o.tlp);
    }
    timeline = redactTimelineEvents(raw.timeline, {
      maxTlp,
      statusByObservableId,
      tlpByObservableId,
      statusByValue,
      tlpByValue,
    });
  }

  const attackMappings = includeSet.has("ttp_mappings") ? raw.attackMappings : [];
  const attackStory = includeSet.has("attack_story") ? raw.attackStory : [];

  // Evidence inventory (metadata only — no storage keys, no binary)
  let evidenceInventory: BuiltReport["evidenceInventory"] = [];
  if (includeSet.has("evidence_inventory")) {
    const evidence = await listEvidenceForCase(opts.caseId, opts.organisationId);
    evidenceInventory = evidence.map((e) => ({
      id: e.id,
      filename: e.filename,
      status: e.status,
      contentType: e.contentType,
      sizeBytes: Number(e.sizeBytes ?? 0),
      sha256: e.sha256,
      relevance: e.relevance,
    }));
    for (const e of evidenceInventory) {
      redaction.items.push({
        section: "evidence_inventory",
        itemId: e.id,
        label: e.filename,
        status: "included",
      });
      redaction.includedCount += 1;
    }
  }

  // Related cases
  let relatedCases: BuiltReport["relatedCases"] = [];
  if (includeSet.has("related_cases")) {
    try {
      const rels = await listRelationshipsCore(opts.organisationId, opts.caseId);
      relatedCases = rels.map((r) => ({
        id: r.otherCase.id,
        caseNumber: r.otherCase.caseNumber,
        title: r.otherCase.title,
        relationshipType: r.relationshipType,
      }));
    } catch {
      relatedCases = [];
    }
  }

  // Custom fields
  let customFields: BuiltReport["customFields"] = [];
  if (includeSet.has("custom_fields")) {
    const defs = await db
      .select()
      .from(customFieldDefinitions)
      .where(
        and(
          eq(customFieldDefinitions.organisationId, opts.organisationId),
          eq(customFieldDefinitions.entity, "case"),
          eq(customFieldDefinitions.isActive, true),
        ),
      );
    if (defs.length > 0) {
      const values = await db
        .select()
        .from(customFieldValues)
        .where(eq(customFieldValues.entityId, opts.caseId));
      const byField = new Map(values.map((v) => [v.fieldId, v.value]));
      customFields = defs.map((d) => ({
        key: d.key,
        label: d.label,
        value: byField.get(d.id) ?? null,
      }));
    }
  }

  // Sanitize free text on the case copy used for rendering
  const caseCopy = {
    ...raw.case,
    title: sanitizeReportText(raw.case.title),
    summary: includeSet.has("summary")
      ? sanitizeReportText(raw.case.summary)
      : null,
    closureSummary: includeSet.has("closure") || includeSet.has("post_incident_review")
      ? sanitizeReportText(raw.case.closureSummary)
      : null,
    rootCause: includeSet.has("post_incident_review")
      ? sanitizeReportText(raw.case.rootCause)
      : null,
    businessImpact: includeSet.has("post_incident_review")
      ? sanitizeReportText(raw.case.businessImpact)
      : null,
    lessonsLearned: includeSet.has("post_incident_review")
      ? sanitizeReportText(raw.case.lessonsLearned)
      : null,
  };

  // Strip metadata-only fields if section excluded
  if (!includeSet.has("metadata")) {
    // Keep case identity for stamps; strip assignee/reporter below.
  }

  const data: CaseReportData = {
    case: caseCopy,
    assignee: includeSet.has("metadata") ? raw.assignee : null,
    reporter: includeSet.has("metadata") ? raw.reporter : null,
    observables,
    tasks,
    timeline,
    comments,
    attackMappings,
    attackStory,
    contentBlocks,
  };

  const dataRevision = computeDataRevision({
    caseId: raw.case.id,
    caseUpdatedAt: raw.case.lastActivityAt,
    caseVersion: raw.case.version,
    observableCount: raw.observables.length,
    taskCount: raw.tasks.length,
    commentCount: raw.comments.length,
    timelineCount: raw.timeline.length,
    contentBlockRevisionSum: raw.contentBlocks.reduce(
      (sum, b) => sum + (b.revisionNumber ?? 0),
      0,
    ),
    evidenceCount: evidenceInventory.length,
    mappingCount: raw.attackMappings.length,
  });

  return {
    data,
    selected,
    includedKeys,
    redaction,
    dataRevision,
    evidenceInventory,
    relatedCases,
    customFields,
    maxTlp,
    maxPap,
  };
}

/** Lightweight existence check for schedules / generation. */
export async function caseExistsInOrg(
  organisationId: string,
  caseId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return Boolean(row);
}
