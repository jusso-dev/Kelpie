/**
 * Review content normalise, fingerprint, and knowledge redaction (issue #64).
 */

import { createHash } from "node:crypto";
import {
  SENSITIVE_CONTENT_KEYS,
  type ReviewContent,
  type ReviewSectionConfig,
  type ReviewSectionKey,
  isReviewSectionKey,
} from "./types";

export class ReviewContentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ReviewContentError";
    this.status = status;
  }
}

function asString(v: unknown, max = 50_000): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new ReviewContentError("Content fields must be strings or arrays");
  }
  const t = v.trim();
  if (t.length > max) {
    throw new ReviewContentError(`Content field exceeds ${max} characters`);
  }
  return t.length === 0 ? undefined : t;
}

function asStringArray(v: unknown, maxItems = 100): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) {
    throw new ReviewContentError("Expected a string array");
  }
  if (v.length > maxItems) {
    throw new ReviewContentError(`Array exceeds ${maxItems} items`);
  }
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") {
      throw new ReviewContentError("Array items must be strings");
    }
    const t = item.trim();
    if (t) out.push(t.slice(0, 2000));
  }
  return out.length ? out : undefined;
}

/**
 * Canonicalise unknown JSON into a typed ReviewContent. Rejects unknown
 * top-level keys so sensitive fields cannot be smuggled under aliases.
 */
export function normaliseReviewContent(raw: unknown): ReviewContent {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ReviewContentError("Content must be an object");
  }
  const o = raw as Record<string, unknown>;
  const allowed = new Set([
    "incidentSummary",
    "businessImpact",
    "detectionSource",
    "detectionEffectiveness",
    "keyEvents",
    "rootCause",
    "contributingFactors",
    "containmentEffectiveness",
    "whatWorked",
    "whatFailed",
    "controlGaps",
    "detectionGaps",
    "processGaps",
    "communicationGaps",
    "participants",
    "knowledgeSummary",
    "themes",
    "sensitiveEvidenceNotes",
    "restrictedNotes",
  ]);
  for (const k of Object.keys(o)) {
    if (!allowed.has(k)) {
      throw new ReviewContentError(`Unknown content field: ${k}`);
    }
  }

  const content: ReviewContent = {};
  content.incidentSummary = asString(o.incidentSummary);
  content.businessImpact = asString(o.businessImpact);
  content.detectionSource = asString(o.detectionSource);
  content.detectionEffectiveness = asString(o.detectionEffectiveness);
  content.rootCause = asString(o.rootCause);
  content.containmentEffectiveness = asString(o.containmentEffectiveness);
  content.knowledgeSummary = asString(o.knowledgeSummary);
  content.sensitiveEvidenceNotes = asString(o.sensitiveEvidenceNotes);
  content.restrictedNotes = asString(o.restrictedNotes);
  content.contributingFactors = asStringArray(o.contributingFactors);
  content.whatWorked = asStringArray(o.whatWorked);
  content.whatFailed = asStringArray(o.whatFailed);
  content.controlGaps = asStringArray(o.controlGaps);
  content.detectionGaps = asStringArray(o.detectionGaps);
  content.processGaps = asStringArray(o.processGaps);
  content.communicationGaps = asStringArray(o.communicationGaps);
  content.themes = asStringArray(o.themes);

  if (o.keyEvents !== undefined && o.keyEvents !== null) {
    if (!Array.isArray(o.keyEvents)) {
      throw new ReviewContentError("keyEvents must be an array");
    }
    content.keyEvents = o.keyEvents.slice(0, 200).map((ev, i) => {
      if (!ev || typeof ev !== "object" || Array.isArray(ev)) {
        throw new ReviewContentError(`keyEvents[${i}] must be an object`);
      }
      const e = ev as Record<string, unknown>;
      const description = asString(e.description, 5000);
      if (!description) {
        throw new ReviewContentError(`keyEvents[${i}].description is required`);
      }
      return {
        at: asString(e.at, 64),
        description,
      };
    });
  }

  if (o.participants !== undefined && o.participants !== null) {
    if (!Array.isArray(o.participants)) {
      throw new ReviewContentError("participants must be an array");
    }
    content.participants = o.participants.slice(0, 100).map((p, i) => {
      if (!p || typeof p !== "object" || Array.isArray(p)) {
        throw new ReviewContentError(`participants[${i}] must be an object`);
      }
      const row = p as Record<string, unknown>;
      const name = asString(row.name, 200);
      if (!name) {
        throw new ReviewContentError(`participants[${i}].name is required`);
      }
      return {
        userId: asString(row.userId, 100),
        name,
        role: asString(row.role, 100),
      };
    });
  }

  // Drop undefined keys for stable fingerprints.
  return JSON.parse(JSON.stringify(content)) as ReviewContent;
}

/** Stable SHA-256 of canonical JSON (sorted keys via JSON.stringify of normalise). */
export function contentFingerprint(content: ReviewContent): string {
  const canonical = JSON.stringify(content);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Strip sensitive / restricted fields for knowledge summaries and external
 * export. Always applied unless includeSensitive is explicitly true AND the
 * caller has already checked view_sensitive authorization.
 */
export function redactContentForKnowledge(
  content: ReviewContent,
  opts?: { includeSensitive?: boolean },
): ReviewContent {
  if (opts?.includeSensitive) {
    return { ...content };
  }
  const out: ReviewContent = { ...content };
  for (const key of SENSITIVE_CONTENT_KEYS) {
    delete out[key];
  }
  return out;
}

/** True if content still holds any sensitive field values. */
export function contentHasSensitiveFields(content: ReviewContent): boolean {
  for (const key of SENSITIVE_CONTENT_KEYS) {
    const v = content[key];
    if (typeof v === "string" && v.trim().length > 0) return true;
  }
  return false;
}

export function normaliseSectionConfigs(raw: unknown): ReviewSectionConfig[] {
  if (!Array.isArray(raw)) {
    throw new ReviewContentError("sections must be an array");
  }
  if (raw.length === 0) {
    throw new ReviewContentError("At least one section is required");
  }
  if (raw.length > 32) {
    throw new ReviewContentError("At most 32 sections allowed");
  }
  const seen = new Set<string>();
  const out: ReviewSectionConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new ReviewContentError("Each section must be an object");
    }
    const s = item as Record<string, unknown>;
    if (typeof s.key !== "string" || !isReviewSectionKey(s.key)) {
      throw new ReviewContentError(`Invalid section key: ${String(s.key)}`);
    }
    if (seen.has(s.key)) {
      throw new ReviewContentError(`Duplicate section key: ${s.key}`);
    }
    seen.add(s.key);
    out.push({
      key: s.key as ReviewSectionKey,
      title:
        typeof s.title === "string" && s.title.trim()
          ? s.title.trim().slice(0, 200)
          : undefined,
      required: Boolean(s.required),
      order:
        typeof s.order === "number" && Number.isFinite(s.order)
          ? Math.max(0, Math.min(1000, Math.trunc(s.order)))
          : out.length,
    });
  }
  out.sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  return out;
}

export const DEFAULT_REVIEW_SECTIONS: ReviewSectionConfig[] = [
  { key: "incident_summary", required: true, order: 0 },
  { key: "business_impact", required: true, order: 1 },
  { key: "detection", required: true, order: 2 },
  { key: "key_events", required: false, order: 3 },
  { key: "root_cause", required: true, order: 4 },
  { key: "containment", required: false, order: 5 },
  { key: "what_worked", required: false, order: 6 },
  { key: "what_failed", required: false, order: 7 },
  { key: "control_gaps", required: false, order: 8 },
  { key: "detection_gaps", required: false, order: 9 },
  { key: "process_gaps", required: false, order: 10 },
  { key: "communication_gaps", required: false, order: 11 },
  { key: "participants", required: false, order: 12 },
  { key: "knowledge_summary", required: true, order: 13 },
];

/**
 * Build a safe knowledge body from review content. Never includes
 * sensitiveEvidenceNotes / restrictedNotes unless includeSensitive.
 */
export function buildKnowledgeBody(
  content: ReviewContent,
  opts?: { includeSensitive?: boolean },
): {
  summary: string;
  body: Record<string, unknown>;
  themes: string[];
  includesSensitive: boolean;
} {
  const safe = redactContentForKnowledge(content, opts);
  const includesSensitive = Boolean(
    opts?.includeSensitive && contentHasSensitiveFields(content),
  );
  const summary =
    safe.knowledgeSummary?.trim() ||
    safe.incidentSummary?.trim() ||
    "Post-incident lessons learned.";
  const body: Record<string, unknown> = {
    incidentSummary: safe.incidentSummary ?? null,
    businessImpact: safe.businessImpact ?? null,
    rootCause: safe.rootCause ?? null,
    whatWorked: safe.whatWorked ?? [],
    whatFailed: safe.whatFailed ?? [],
    controlGaps: safe.controlGaps ?? [],
    detectionGaps: safe.detectionGaps ?? [],
    processGaps: safe.processGaps ?? [],
    communicationGaps: safe.communicationGaps ?? [],
    themes: safe.themes ?? [],
  };
  if (includesSensitive) {
    body.sensitiveEvidenceNotes = content.sensitiveEvidenceNotes ?? null;
    body.restrictedNotes = content.restrictedNotes ?? null;
  }
  return {
    summary: summary.slice(0, 5000),
    body,
    themes: safe.themes ?? [],
    includesSensitive,
  };
}
