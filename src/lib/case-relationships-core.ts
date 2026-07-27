/**
 * Core case-relationship mutations and queries, callable from both server
 * actions and API routes. Callers must already have resolved
 * `organisationId` for the acting user/token; every function re-verifies
 * that every case id it touches belongs to that organisation before doing
 * anything with it.
 */

import { db } from "@/db";
import {
  cases,
  caseRelationships,
  caseRelationshipDismissals,
  observables,
  vendorWatchlist,
} from "@/db/schema";
import { and, eq, inArray, or, ne } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";
import { normalizeTags } from "./tags";
import { extractCaseIndicators } from "./ti/case-enrichment";
import { matchingVendors, type WatchedVendor } from "./vendor-news";
import {
  scoreCaseRelationship,
  SUGGESTION_SCORE_THRESHOLD,
  type ScoringCaseInput,
  type MatchedSignals,
} from "./case-relationships-scoring";

export const RELATIONSHIP_TYPES = [
  "duplicate_of",
  "related_to",
  "parent_of",
  "child_of",
] as const;
export type RelationshipTypeInput = (typeof RELATIONSHIP_TYPES)[number];
export type StoredRelationshipType = "duplicate_of" | "related_to" | "parent_of";
export type RelationshipOrigin = "analyst" | "provider" | "rule";

export class CaseRelationshipError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CaseRelationshipError";
    this.status = status;
  }
}

async function loadCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      summary: cases.summary,
      status: cases.status,
      severity: cases.severity,
      tags: cases.tags,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

async function loadCasesInOrg(caseIds: string[], organisationId: string) {
  if (caseIds.length === 0) return [];
  return db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      summary: cases.summary,
      status: cases.status,
      severity: cases.severity,
      tags: cases.tags,
    })
    .from(cases)
    .where(
      and(eq(cases.organisationId, organisationId), inArray(cases.id, caseIds)),
    );
}

async function loadObservableValuesByCase(
  caseIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (caseIds.length === 0) return out;
  const rows = await db
    .select({ caseId: observables.caseId, value: observables.value })
    .from(observables)
    .where(inArray(observables.caseId, caseIds));
  for (const row of rows) {
    const list = out.get(row.caseId) ?? [];
    list.push(row.value);
    out.set(row.caseId, list);
  }
  return out;
}

async function loadOrgVendors(organisationId: string): Promise<WatchedVendor[]> {
  return db
    .select({
      id: vendorWatchlist.id,
      catalogSlug: vendorWatchlist.catalogSlug,
      displayName: vendorWatchlist.displayName,
      website: vendorWatchlist.website,
      category: vendorWatchlist.category,
      aliases: vendorWatchlist.aliases,
    })
    .from(vendorWatchlist)
    .where(eq(vendorWatchlist.organisationId, organisationId));
}

function toScoringInput(
  row: { title: string; summary: string | null; tags: unknown },
  observableValues: string[],
  vendors: WatchedVendor[],
): ScoringCaseInput {
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((t): t is string => typeof t === "string")
    : [];
  const vendorSlugs = matchingVendors(
    { title: row.title, summary: row.summary ?? "" },
    vendors,
  ).map((v) => v.catalogSlug);
  return {
    title: row.title,
    summary: row.summary,
    tags: normalizeTags(tags),
    observableValues,
    vendorSlugs,
  };
}

function canonicalPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Canonicalises the requested type/direction into the storage shape, so `child_of` and reverse-order `related_to` never create a second row for an edge that already exists. */
function canonicalize(
  sourceCaseId: string,
  targetCaseId: string,
  relationshipType: RelationshipTypeInput,
): { sourceCaseId: string; targetCaseId: string; relationshipType: StoredRelationshipType } {
  if (relationshipType === "child_of") {
    return { sourceCaseId: targetCaseId, targetCaseId: sourceCaseId, relationshipType: "parent_of" };
  }
  if (relationshipType === "related_to") {
    const [a, b] = canonicalPair(sourceCaseId, targetCaseId);
    return { sourceCaseId: a, targetCaseId: b, relationshipType: "related_to" };
  }
  return { sourceCaseId, targetCaseId, relationshipType };
}

function displayType(
  stored: StoredRelationshipType,
  viewedFromTarget: boolean,
): RelationshipTypeInput {
  if (stored === "parent_of" && viewedFromTarget) return "child_of";
  return stored;
}

export type LinkCasesInput = {
  targetCaseId: string;
  relationshipType: RelationshipTypeInput;
  reason: string;
  confidence?: number | null;
  origin?: RelationshipOrigin;
  ruleId?: string | null;
  ruleVersion?: string | null;
};

export type CaseRelationshipView = {
  id: string;
  relationshipType: RelationshipTypeInput;
  direction: "outgoing" | "incoming" | "symmetric";
  confidence: number | null;
  origin: RelationshipOrigin;
  ruleId: string | null;
  ruleVersion: string | null;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
  otherCase: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    severity: string;
  };
};

export async function linkCasesCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: LinkCasesInput,
): Promise<CaseRelationshipView> {
  const reason = input.reason.trim();
  if (!reason) throw new CaseRelationshipError("A reason is required to link cases");
  if (!RELATIONSHIP_TYPES.includes(input.relationshipType)) {
    throw new CaseRelationshipError("Unknown relationship type");
  }
  if (caseId === input.targetCaseId) {
    throw new CaseRelationshipError("A case cannot be linked to itself");
  }
  if (
    input.confidence !== undefined &&
    input.confidence !== null &&
    (input.confidence < 0 || input.confidence > 100)
  ) {
    throw new CaseRelationshipError("Confidence must be between 0 and 100");
  }

  const [source, target] = await Promise.all([
    loadCaseInOrg(caseId, organisationId),
    loadCaseInOrg(input.targetCaseId, organisationId),
  ]);
  if (!source) throw new CaseRelationshipError("Case not found", 404);
  if (!target) throw new CaseRelationshipError("Target case not found", 404);

  const canonical = canonicalize(caseId, input.targetCaseId, input.relationshipType);
  const origin = input.origin ?? "analyst";

  const reverseConflict =
    canonical.relationshipType !== "related_to"
      ? await db
          .select({ id: caseRelationships.id })
          .from(caseRelationships)
          .where(
            and(
              eq(caseRelationships.organisationId, organisationId),
              eq(caseRelationships.sourceCaseId, canonical.targetCaseId),
              eq(caseRelationships.targetCaseId, canonical.sourceCaseId),
              eq(caseRelationships.relationshipType, canonical.relationshipType),
            ),
          )
          .limit(1)
      : [];
  if (reverseConflict.length > 0) {
    throw new CaseRelationshipError(
      "A conflicting relationship already exists between these cases",
      409,
    );
  }

  const exactExisting = await db
    .select({ id: caseRelationships.id })
    .from(caseRelationships)
    .where(
      and(
        eq(caseRelationships.organisationId, organisationId),
        eq(caseRelationships.sourceCaseId, canonical.sourceCaseId),
        eq(caseRelationships.targetCaseId, canonical.targetCaseId),
        eq(caseRelationships.relationshipType, canonical.relationshipType),
      ),
    )
    .limit(1);
  if (exactExisting.length > 0) {
    throw new CaseRelationshipError("These cases are already linked this way", 409);
  }

  const id = newId("caserel");
  const confidence =
    input.confidence !== undefined && input.confidence !== null
      ? Math.round(input.confidence)
      : origin === "analyst"
        ? 100
        : null;

  const [inserted] = await db
    .insert(caseRelationships)
    .values({
      id,
      organisationId,
      sourceCaseId: canonical.sourceCaseId,
      targetCaseId: canonical.targetCaseId,
      relationshipType: canonical.relationshipType,
      confidence,
      origin,
      ruleId: input.ruleId ?? null,
      ruleVersion: input.ruleVersion ?? null,
      reason,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted) {
    throw new CaseRelationshipError("These cases are already linked this way", 409);
  }

  const sourceIsCaseId = canonical.sourceCaseId === caseId;
  await Promise.all([
    writeTimelineEvent({
      caseId: canonical.sourceCaseId,
      actorId,
      eventType: "relationship_created",
      payload: {
        relationship_id: id,
        relationship_type: canonical.relationshipType,
        direction: "source",
        other_case_id: canonical.targetCaseId,
        origin,
        reason,
      },
    }),
    writeTimelineEvent({
      caseId: canonical.targetCaseId,
      actorId,
      eventType: "relationship_created",
      payload: {
        relationship_id: id,
        relationship_type: canonical.relationshipType,
        direction: "target",
        other_case_id: canonical.sourceCaseId,
        origin,
        reason,
      },
    }),
  ]);

  const otherCase = sourceIsCaseId ? target : source;
  return {
    id,
    relationshipType: displayType(canonical.relationshipType, !sourceIsCaseId),
    direction:
      canonical.relationshipType === "related_to"
        ? "symmetric"
        : sourceIsCaseId
          ? "outgoing"
          : "incoming",
    confidence,
    origin,
    ruleId: input.ruleId ?? null,
    ruleVersion: input.ruleVersion ?? null,
    reason,
    createdBy: actorId,
    createdAt: inserted.createdAt,
    otherCase: {
      id: otherCase.id,
      caseNumber: otherCase.caseNumber,
      title: otherCase.title,
      status: otherCase.status,
      severity: otherCase.severity,
    },
  };
}

export async function listRelationshipsCore(
  organisationId: string,
  caseId: string,
): Promise<CaseRelationshipView[]> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new CaseRelationshipError("Case not found", 404);

  const rows = await db
    .select()
    .from(caseRelationships)
    .where(
      and(
        eq(caseRelationships.organisationId, organisationId),
        or(
          eq(caseRelationships.sourceCaseId, caseId),
          eq(caseRelationships.targetCaseId, caseId),
        ),
      ),
    );
  if (rows.length === 0) return [];

  const otherIds = rows.map((r) => (r.sourceCaseId === caseId ? r.targetCaseId : r.sourceCaseId));
  const otherCases = await loadCasesInOrg(otherIds, organisationId);
  const otherById = new Map(otherCases.map((c) => [c.id, c]));

  return rows
    .map((row): CaseRelationshipView | null => {
      const sourceIsCaseId = row.sourceCaseId === caseId;
      const otherCase = otherById.get(sourceIsCaseId ? row.targetCaseId : row.sourceCaseId);
      if (!otherCase) return null;
      return {
        id: row.id,
        relationshipType: displayType(row.relationshipType, !sourceIsCaseId),
        direction:
          row.relationshipType === "related_to"
            ? ("symmetric" as const)
            : sourceIsCaseId
              ? ("outgoing" as const)
              : ("incoming" as const),
        confidence: row.confidence,
        origin: row.origin,
        ruleId: row.ruleId,
        ruleVersion: row.ruleVersion,
        reason: row.reason,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        otherCase: {
          id: otherCase.id,
          caseNumber: otherCase.caseNumber,
          title: otherCase.title,
          status: otherCase.status,
          severity: otherCase.severity,
        },
      };
    })
    .filter((v): v is CaseRelationshipView => v !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function unlinkCaseCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  relationshipId: string,
  reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new CaseRelationshipError("A reason is required to unlink cases");

  const [row] = await db
    .select()
    .from(caseRelationships)
    .where(
      and(
        eq(caseRelationships.id, relationshipId),
        eq(caseRelationships.organisationId, organisationId),
        or(
          eq(caseRelationships.sourceCaseId, caseId),
          eq(caseRelationships.targetCaseId, caseId),
        ),
      ),
    )
    .limit(1);
  if (!row) throw new CaseRelationshipError("Relationship not found", 404);

  await db.delete(caseRelationships).where(eq(caseRelationships.id, relationshipId));

  await Promise.all([
    writeTimelineEvent({
      caseId: row.sourceCaseId,
      actorId,
      eventType: "relationship_removed",
      payload: {
        relationship_id: row.id,
        relationship_type: row.relationshipType,
        direction: "source",
        other_case_id: row.targetCaseId,
        reason: trimmedReason,
      },
    }),
    writeTimelineEvent({
      caseId: row.targetCaseId,
      actorId,
      eventType: "relationship_removed",
      payload: {
        relationship_id: row.id,
        relationship_type: row.relationshipType,
        direction: "target",
        other_case_id: row.sourceCaseId,
        reason: trimmedReason,
      },
    }),
  ]);
}

export type SuggestionView = {
  candidateCase: {
    id: string;
    caseNumber: string;
    title: string;
    status: string;
    severity: string;
  };
  score: number;
  matchedSignals: MatchedSignals;
  suggestedType: "duplicate_of" | "related_to";
};

async function scoreAgainstCandidates(
  organisationId: string,
  target: ScoringCaseInput,
  candidates: Awaited<ReturnType<typeof loadCasesInOrg>>,
  excludePairs: Set<string>,
  limit: number,
): Promise<Array<SuggestionView & { candidateCaseIdInternal: string }>> {
  if (candidates.length === 0) return [];
  const observablesByCase = await loadObservableValuesByCase(candidates.map((c) => c.id));
  const vendors = await loadOrgVendors(organisationId);

  const scored = candidates
    .map((candidate) => {
      const candidateInput = toScoringInput(
        candidate,
        observablesByCase.get(candidate.id) ?? [],
        vendors,
      );
      const result = scoreCaseRelationship(candidateInput, target);
      return { candidate, result };
    })
    .filter((entry) => entry.result.score >= SUGGESTION_SCORE_THRESHOLD)
    .filter((entry) => !excludePairs.has(entry.candidate.id))
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit);

  return scored.map((entry) => ({
    candidateCaseIdInternal: entry.candidate.id,
    candidateCase: {
      id: entry.candidate.id,
      caseNumber: entry.candidate.caseNumber,
      title: entry.candidate.title,
      status: entry.candidate.status,
      severity: entry.candidate.severity,
    },
    score: entry.result.score,
    matchedSignals: entry.result.matchedSignals,
    suggestedType: entry.result.suggestedType,
  }));
}

export async function listSuggestionsCore(
  organisationId: string,
  caseId: string,
  limit = 10,
): Promise<SuggestionView[]> {
  const caseRow = await loadCaseInOrg(caseId, organisationId);
  if (!caseRow) throw new CaseRelationshipError("Case not found", 404);

  const [ownObservables, allOrgCases, relatedRows, dismissedRows] = await Promise.all([
    loadObservableValuesByCase([caseId]).then((m) => m.get(caseId) ?? []),
    db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        title: cases.title,
        summary: cases.summary,
        status: cases.status,
        severity: cases.severity,
        tags: cases.tags,
      })
      .from(cases)
      .where(and(eq(cases.organisationId, organisationId), ne(cases.id, caseId))),
    db
      .select({ sourceCaseId: caseRelationships.sourceCaseId, targetCaseId: caseRelationships.targetCaseId })
      .from(caseRelationships)
      .where(
        and(
          eq(caseRelationships.organisationId, organisationId),
          or(
            eq(caseRelationships.sourceCaseId, caseId),
            eq(caseRelationships.targetCaseId, caseId),
          ),
        ),
      ),
    db
      .select({ caseIdA: caseRelationshipDismissals.caseIdA, caseIdB: caseRelationshipDismissals.caseIdB })
      .from(caseRelationshipDismissals)
      .where(
        and(
          eq(caseRelationshipDismissals.organisationId, organisationId),
          or(
            eq(caseRelationshipDismissals.caseIdA, caseId),
            eq(caseRelationshipDismissals.caseIdB, caseId),
          ),
        ),
      ),
  ]);

  const excludeIds = new Set<string>();
  for (const r of relatedRows) {
    excludeIds.add(r.sourceCaseId === caseId ? r.targetCaseId : r.sourceCaseId);
  }
  for (const d of dismissedRows) {
    excludeIds.add(d.caseIdA === caseId ? d.caseIdB : d.caseIdA);
  }

  const vendors = await loadOrgVendors(organisationId);
  const target = toScoringInput(caseRow, ownObservables, vendors);
  const results = await scoreAgainstCandidates(
    organisationId,
    target,
    allOrgCases,
    excludeIds,
    limit,
  );
  return results.map(({ candidateCaseIdInternal: _drop, ...rest }) => rest);
}

export async function scoreDraftCandidatesCore(
  organisationId: string,
  draft: { title: string; summary?: string | null; tags?: string[] },
  limit = 10,
): Promise<SuggestionView[]> {
  if (!draft.title?.trim()) return [];
  const allOrgCases = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      summary: cases.summary,
      status: cases.status,
      severity: cases.severity,
      tags: cases.tags,
    })
    .from(cases)
    .where(eq(cases.organisationId, organisationId));

  const target: ScoringCaseInput = {
    title: draft.title,
    summary: draft.summary ?? null,
    tags: normalizeTags(draft.tags ?? []),
    observableValues: extractCaseIndicators(draft.title, draft.summary),
    vendorSlugs: matchingVendors(
      { title: draft.title, summary: draft.summary ?? "" },
      await loadOrgVendors(organisationId),
    ).map((v) => v.catalogSlug),
  };

  const results = await scoreAgainstCandidates(
    organisationId,
    target,
    allOrgCases,
    new Set(),
    limit,
  );
  return results.map(({ candidateCaseIdInternal: _drop, ...rest }) => rest);
}

export async function dismissSuggestionCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  candidateCaseId: string,
  reason: string,
): Promise<void> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    throw new CaseRelationshipError("A reason is required to dismiss a suggestion");
  }
  if (caseId === candidateCaseId) {
    throw new CaseRelationshipError("A case cannot be dismissed against itself");
  }
  const [caseRow, candidateRow] = await Promise.all([
    loadCaseInOrg(caseId, organisationId),
    loadCaseInOrg(candidateCaseId, organisationId),
  ]);
  if (!caseRow) throw new CaseRelationshipError("Case not found", 404);
  if (!candidateRow) throw new CaseRelationshipError("Candidate case not found", 404);

  const [caseIdA, caseIdB] = canonicalPair(caseId, candidateCaseId);
  await db
    .insert(caseRelationshipDismissals)
    .values({
      id: newId("casedismiss"),
      organisationId,
      caseIdA,
      caseIdB,
      reason: trimmedReason,
      dismissedBy: actorId,
    })
    .onConflictDoNothing();

  await Promise.all([
    writeTimelineEvent({
      caseId,
      actorId,
      eventType: "relationship_suggestion_dismissed",
      payload: { other_case_id: candidateCaseId, reason: trimmedReason },
    }),
    writeTimelineEvent({
      caseId: candidateCaseId,
      actorId,
      eventType: "relationship_suggestion_dismissed",
      payload: { other_case_id: caseId, reason: trimmedReason },
    }),
  ]);
}
