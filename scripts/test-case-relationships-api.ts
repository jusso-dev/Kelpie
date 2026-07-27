/**
 * HTTP-level acceptance coverage for the case-relationships feature (issue
 * #43): create/list/unlink relationships, duplicate/related suggestions, and
 * dismissals — all exercised against the real running routes and a real
 * Postgres instance, mirroring `scripts/test-tawny-api.ts`'s structure
 * (two-organisation tenant isolation fixtures, real `fetch()` calls, full
 * teardown with zero-rows-remain assertions at the end).
 *
 * This script assumes a server is already listening at `API_BASE_URL`
 * (default `http://127.0.0.1:3111`) against the same `DATABASE_URL` this
 * process uses, and that migrations have already been applied.
 */
import assert from "node:assert/strict";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "../src/db";
import {
  apiTokens,
  caseRelationshipDismissals,
  caseRelationships,
  cases,
  observables,
  organisations,
  timelineEvents,
} from "../src/db/schema";
import { generateApiToken } from "../src/lib/api-tokens";
import { newId } from "../src/lib/utils";

const BASE_URL = process.env.API_BASE_URL ?? "http://127.0.0.1:3111";

const runId = newId("caserelapitest").slice("caserelapitest_".length).slice(0, 12);
const orgAId = `org_caserelapi_a_${runId}`;
const orgBId = `org_caserelapi_b_${runId}`;

const FULL_SCOPES = [
  "case_relationships:read",
  "case_relationships:write",
  "cases:read",
  "cases:write",
];

type RelationshipRow = {
  id: string;
  relationshipType: string;
  direction: string;
  otherCase: { id: string; caseNumber: string; title: string; status: string; severity: string };
  reason: string;
};

type SuggestionRow = {
  candidateCase: { id: string; caseNumber: string; title: string };
  score: number;
  matchedSignals: {
    titleSimilarity: number;
    sharedObservables: string[];
    sharedTags: string[];
    sharedVendors: string[];
  };
  suggestedType: string;
};

async function createOrg(id: string, name: string): Promise<void> {
  await db.insert(organisations).values({ id, name, slug: id.replace(/_/g, "-") });
}

async function createToken(organisationId: string, name: string, scopes: string[]): Promise<string> {
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("api_token"),
    organisationId,
    name,
    tokenHash: hash,
    scopes,
  });
  return plaintext;
}

let caseCounter = 0;
async function createCase(
  organisationId: string,
  overrides: Partial<typeof cases.$inferInsert> = {},
): Promise<string> {
  caseCounter += 1;
  const id = newId("case");
  await db.insert(cases).values({
    id,
    organisationId,
    caseNumber: `CASEREL-${runId}-${String(caseCounter).padStart(3, "0")}`,
    title: `Case relationship fixture ${caseCounter}`,
    ...overrides,
  });
  return id;
}

async function addObservables(caseId: string, values: string[]): Promise<void> {
  if (values.length === 0) return;
  await db.insert(observables).values(
    values.map((value) => ({
      id: newId("obs"),
      caseId,
      type: "ip" as const,
      value,
    })),
  );
}

function headers(token: string): Record<string, string> {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function link(token: string, caseId: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/relationships`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(body),
  });
}

function listRelationships(token: string, caseId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/relationships`, {
    headers: headers(token),
  });
}

function unlink(
  token: string,
  caseId: string,
  relationshipId: string,
  reason: string | undefined,
): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/relationships/${relationshipId}`, {
    method: "DELETE",
    headers: headers(token),
    body: JSON.stringify(reason === undefined ? {} : { reason }),
  });
}

function listSuggestions(token: string, caseId: string): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/relationships/suggestions`, {
    headers: headers(token),
  });
}

function dismissSuggestion(
  token: string,
  caseId: string,
  candidateCaseId: string,
  reason: string | undefined,
): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/cases/${caseId}/relationships/suggestions/dismiss`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(reason === undefined ? { candidateCaseId } : { candidateCaseId, reason }),
  });
}

async function relationshipRowsBetween(a: string, b: string) {
  return db
    .select()
    .from(caseRelationships)
    .where(
      or(
        and(eq(caseRelationships.sourceCaseId, a), eq(caseRelationships.targetCaseId, b)),
        and(eq(caseRelationships.sourceCaseId, b), eq(caseRelationships.targetCaseId, a)),
      ),
    );
}

async function timelineEventsFor(caseId: string, eventType?: string) {
  const rows = await db
    .select()
    .from(timelineEvents)
    .where(eq(timelineEvents.caseId, caseId));
  return eventType ? rows.filter((r) => r.eventType === eventType) : rows;
}

async function main() {
  await createOrg(orgAId, "Case Relationships API Test Org A");
  await createOrg(orgBId, "Case Relationships API Test Org B");

  const orgAToken = await createToken(orgAId, "orgA full", FULL_SCOPES);
  const orgARestrictedToken = await createToken(orgAId, "orgA read-only", ["cases:read"]);
  const orgBToken = await createToken(orgBId, "orgB full", FULL_SCOPES);

  const orgACaseIds: string[] = [];
  const orgBCaseIds: string[] = [];

  async function seedCase(org: "A" | "B", overrides: Partial<typeof cases.$inferInsert> = {}) {
    const id = await createCase(org === "A" ? orgAId : orgBId, overrides);
    (org === "A" ? orgACaseIds : orgBCaseIds).push(id);
    return id;
  }

  try {
    // ── 1. Create a relationship, bidirectional visibility ──────────────────
    const parentCase = await seedCase("A", { title: "Parent incident: credential stuffing wave" });
    const childCase = await seedCase("A", { title: "Child incident: single account takeover" });

    const createRes = await link(orgAToken, parentCase, {
      targetCaseId: childCase,
      relationshipType: "parent_of",
      reason: "Same campaign, this case tracks the broader wave",
    });
    assert.equal(createRes.status, 201, `link must return 201, got ${createRes.status}`);
    const createJson = (await createRes.json()) as { relationship: RelationshipRow };
    assert.ok(createJson.relationship.id, "create response must include a relationship id");

    const parentListRes = await listRelationships(orgAToken, parentCase);
    assert.equal(parentListRes.status, 200);
    const parentList = (await parentListRes.json()) as { relationships: RelationshipRow[] };
    const parentEntry = parentList.relationships.find((r) => r.otherCase.id === childCase);
    assert.ok(parentEntry, "parent case's relationship list must include the child case");
    assert.equal(parentEntry?.relationshipType, "parent_of");
    assert.equal(parentEntry?.direction, "outgoing");

    const childListRes = await listRelationships(orgAToken, childCase);
    assert.equal(childListRes.status, 200);
    const childList = (await childListRes.json()) as { relationships: RelationshipRow[] };
    const childEntry = childList.relationships.find((r) => r.otherCase.id === parentCase);
    assert.ok(childEntry, "child case's relationship list must include the parent case");
    assert.equal(
      childEntry?.relationshipType,
      "child_of",
      "viewed from the child case, a parent_of edge must be inverted to child_of",
    );
    assert.equal(childEntry?.direction, "incoming");

    // ── 2. Missing/empty reason → 400, nothing persisted ────────────────────
    const missingReasonA = await seedCase("A");
    const missingReasonB = await seedCase("A");
    const beforeRows = await relationshipRowsBetween(missingReasonA, missingReasonB);
    const beforeTimelineA = await timelineEventsFor(missingReasonA);

    const missingRes = await link(orgAToken, missingReasonA, {
      targetCaseId: missingReasonB,
      relationshipType: "related_to",
      reason: "",
    });
    assert.equal(missingRes.status, 400, `empty reason must return 400, got ${missingRes.status}`);

    const noReasonRes = await link(orgAToken, missingReasonA, {
      targetCaseId: missingReasonB,
      relationshipType: "related_to",
    });
    assert.equal(noReasonRes.status, 400, `missing reason field must return 400, got ${noReasonRes.status}`);

    const afterRows = await relationshipRowsBetween(missingReasonA, missingReasonB);
    assert.equal(afterRows.length, beforeRows.length, "no relationship row must be created for a missing/empty reason");
    const afterTimelineA = await timelineEventsFor(missingReasonA);
    assert.equal(
      afterTimelineA.length,
      beforeTimelineA.length,
      "no timeline event must be written for a rejected missing-reason link attempt",
    );

    // ── 3. Self-link rejected ────────────────────────────────────────────────
    const selfCase = await seedCase("A");
    const selfRes = await link(orgAToken, selfCase, {
      targetCaseId: selfCase,
      relationshipType: "related_to",
      reason: "Should be rejected",
    });
    assert.ok(
      selfRes.status === 400 || selfRes.status === 409,
      `self-link must be rejected with 400 or 409, got ${selfRes.status}`,
    );

    // ── 4. Duplicate edge rejected ───────────────────────────────────────────
    const dupA = await seedCase("A");
    const dupB = await seedCase("A");
    const dupFirstRes = await link(orgAToken, dupA, {
      targetCaseId: dupB,
      relationshipType: "related_to",
      reason: "First link",
    });
    assert.equal(dupFirstRes.status, 201, `first duplicate-edge link must succeed, got ${dupFirstRes.status}`);
    const dupSecondRes = await link(orgAToken, dupA, {
      targetCaseId: dupB,
      relationshipType: "related_to",
      reason: "Second link, should be rejected",
    });
    assert.equal(dupSecondRes.status, 409, `exact duplicate edge must return 409, got ${dupSecondRes.status}`);
    const dupRows = await relationshipRowsBetween(dupA, dupB);
    assert.equal(dupRows.length, 1, "exactly one relationship row must exist after a rejected duplicate attempt");

    // ── 5. Reverse-direction duplicate rejected (directional type) ──────────
    const revParent = await seedCase("A");
    const revChild = await seedCase("A");
    const revFirstRes = await link(orgAToken, revParent, {
      targetCaseId: revChild,
      relationshipType: "parent_of",
      reason: "revParent is the parent",
    });
    assert.equal(revFirstRes.status, 201, `first parent_of link must succeed, got ${revFirstRes.status}`);
    // Attempt the reverse claim: revChild parent_of revParent.
    const revReverseRes = await link(orgAToken, revChild, {
      targetCaseId: revParent,
      relationshipType: "parent_of",
      reason: "Conflicting reverse claim",
    });
    assert.equal(
      revReverseRes.status,
      409,
      `reverse-direction parent_of claim must return 409, got ${revReverseRes.status}`,
    );
    const revRows = await relationshipRowsBetween(revParent, revChild);
    assert.equal(revRows.length, 1, "only the original parent_of edge must exist after a rejected reverse claim");

    // ── 6. Cross-tenant link rejected ────────────────────────────────────────
    const crossA = await seedCase("A");
    const crossB = await seedCase("B");
    const crossRes = await link(orgAToken, crossA, {
      targetCaseId: crossB,
      relationshipType: "related_to",
      reason: "Should never succeed across tenants",
    });
    assert.equal(
      crossRes.status,
      404,
      `cross-tenant link attempt must return 404 (target not found in caller's org), got ${crossRes.status}`,
    );
    const crossRows = await relationshipRowsBetween(crossA, crossB);
    assert.equal(crossRows.length, 0, "no relationship row may ever link cases across organisations");

    // ── 7. Suggestions: same-org match visible, cross-org match hidden ──────
    const sugTitle = "Widespread phishing campaign targeting payroll staff";
    const sharedObservableValues = ["203.0.113.77", "198.51.100.44"];
    const sugE = await seedCase("A", { title: sugTitle, tags: ["phishing", "payroll"] });
    const sugF = await seedCase("A", {
      title: "Widespread phishing campaign targeting payroll department",
      tags: ["phishing", "payroll"],
    });
    const sugGCrossOrg = await seedCase("B", { title: sugTitle, tags: ["phishing", "payroll"] });
    await addObservables(sugE, sharedObservableValues);
    await addObservables(sugF, sharedObservableValues);

    const suggestionsRes = await listSuggestions(orgAToken, sugE);
    assert.equal(suggestionsRes.status, 200, `suggestions GET must return 200, got ${suggestionsRes.status}`);
    const suggestionsJson = (await suggestionsRes.json()) as { suggestions: SuggestionRow[] };
    const foundF = suggestionsJson.suggestions.find((s) => s.candidateCase.id === sugF);
    assert.ok(foundF, "near-duplicate same-org case must appear in suggestions");
    assert.ok(typeof foundF?.score === "number" && foundF.score > 0, "suggestion must include a positive score");
    const hasNonEmptySignal =
      (foundF?.matchedSignals.sharedObservables.length ?? 0) > 0 ||
      (foundF?.matchedSignals.sharedTags.length ?? 0) > 0 ||
      (foundF?.matchedSignals.titleSimilarity ?? 0) > 0;
    assert.ok(hasNonEmptySignal, "suggestion matchedSignals must be non-empty");
    assert.ok(
      !suggestionsJson.suggestions.some((s) => s.candidateCase.id === sugGCrossOrg),
      "suggestions must never leak a near-duplicate case from a different organisation",
    );

    // ── 8. Dismiss a suggestion ───────────────────────────────────────────────
    const dismissRes = await dismissSuggestion(orgAToken, sugE, sugF, "Reviewed — unrelated despite the overlap");
    assert.equal(dismissRes.status, 200, `dismiss must return 200, got ${dismissRes.status}`);
    const afterDismissRes = await listSuggestions(orgAToken, sugE);
    const afterDismissJson = (await afterDismissRes.json()) as { suggestions: SuggestionRow[] };
    assert.ok(
      !afterDismissJson.suggestions.some((s) => s.candidateCase.id === sugF),
      "dismissed candidate must no longer appear in the suggestions list",
    );

    // ── 9. Unlink ─────────────────────────────────────────────────────────────
    const unlinkA = await seedCase("A");
    const unlinkB = await seedCase("A");
    const unlinkCreateRes = await link(orgAToken, unlinkA, {
      targetCaseId: unlinkB,
      relationshipType: "related_to",
      reason: "Temporary link for unlink test",
    });
    assert.equal(unlinkCreateRes.status, 201);
    const unlinkCreateJson = (await unlinkCreateRes.json()) as { relationship: RelationshipRow };
    const relationshipId = unlinkCreateJson.relationship.id;

    const unlinkRes = await unlink(orgAToken, unlinkA, relationshipId, "No longer related after review");
    assert.equal(unlinkRes.status, 200, `unlink must return 200, got ${unlinkRes.status}`);

    const unlinkAListRes = await listRelationships(orgAToken, unlinkA);
    const unlinkAList = (await unlinkAListRes.json()) as { relationships: RelationshipRow[] };
    assert.ok(
      !unlinkAList.relationships.some((r) => r.id === relationshipId),
      "unlinked relationship must no longer appear on the source case's list",
    );
    const unlinkBListRes = await listRelationships(orgAToken, unlinkB);
    const unlinkBList = (await unlinkBListRes.json()) as { relationships: RelationshipRow[] };
    assert.ok(
      !unlinkBList.relationships.some((r) => r.id === relationshipId),
      "unlinked relationship must no longer appear on the target case's list",
    );

    const removedEventsA = await timelineEventsFor(unlinkA, "relationship_removed");
    const removedEventsB = await timelineEventsFor(unlinkB, "relationship_removed");
    assert.ok(removedEventsA.length >= 1, "a relationship_removed timeline event must exist on the source case");
    assert.ok(removedEventsB.length >= 1, "a relationship_removed timeline event must exist on the target case");
    const createdEventsA = await timelineEventsFor(unlinkA, "relationship_created");
    assert.ok(
      createdEventsA.length >= 1,
      "the earlier relationship_created event must still exist (timeline is append-only, never updated/deleted)",
    );

    // ── 10. Authorization: restricted-scope token forbidden on write ops ────
    const authzA = await seedCase("A");
    const authzB = await seedCase("A");
    const forbiddenLinkRes = await link(orgARestrictedToken, authzA, {
      targetCaseId: authzB,
      relationshipType: "related_to",
      reason: "Should be forbidden",
    });
    assert.equal(
      forbiddenLinkRes.status,
      403,
      `link with a read-only token must return 403, got ${forbiddenLinkRes.status}`,
    );
    const forbiddenUnlinkRes = await unlink(orgARestrictedToken, authzA, relationshipId, "Should be forbidden");
    assert.equal(
      forbiddenUnlinkRes.status,
      403,
      `unlink with a read-only token must return 403, got ${forbiddenUnlinkRes.status}`,
    );
    const forbiddenDismissRes = await dismissSuggestion(orgARestrictedToken, authzA, authzB, "Should be forbidden");
    assert.equal(
      forbiddenDismissRes.status,
      403,
      `dismiss with a read-only token must return 403, got ${forbiddenDismissRes.status}`,
    );

    // ── 11. Closed-case linkability ──────────────────────────────────────────
    const closedCase = await seedCase("A", {
      status: "closed",
      closedAt: new Date(),
      closureReason: "resolved_true_positive",
    });
    const closedPeer = await seedCase("A");
    const closedLinkRes = await link(orgAToken, closedCase, {
      targetCaseId: closedPeer,
      relationshipType: "related_to",
      reason: "Closed case still needs to be linkable",
    });
    assert.equal(
      closedLinkRes.status,
      201,
      `linking a closed case must succeed, got ${closedLinkRes.status}: ${await closedLinkRes.text()}`,
    );
    const [closedCaseRow] = await db
      .select({ status: cases.status })
      .from(cases)
      .where(eq(cases.id, closedCase))
      .limit(1);
    assert.equal(closedCaseRow?.status, "closed", "linking must never change a case's status");

    console.log("case relationships api tests passed");
  } finally {
    const allCaseIds = [...orgACaseIds, ...orgBCaseIds];
    if (allCaseIds.length > 0) {
      await db.delete(timelineEvents).where(inArray(timelineEvents.caseId, allCaseIds));
      await db.delete(observables).where(inArray(observables.caseId, allCaseIds));
      await db
        .delete(caseRelationships)
        .where(
          or(
            inArray(caseRelationships.sourceCaseId, allCaseIds),
            inArray(caseRelationships.targetCaseId, allCaseIds),
          ),
        );
      await db
        .delete(caseRelationshipDismissals)
        .where(
          or(
            inArray(caseRelationshipDismissals.caseIdA, allCaseIds),
            inArray(caseRelationshipDismissals.caseIdB, allCaseIds),
          ),
        );
      await db.delete(cases).where(inArray(cases.id, allCaseIds));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(apiTokens).where(eq(apiTokens.organisationId, orgId));
    }
    for (const orgId of [orgAId, orgBId]) {
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }

    const remainingCases = await db
      .select({ id: cases.id })
      .from(cases)
      .where(inArray(cases.id, allCaseIds));
    const remainingRelationships =
      allCaseIds.length > 0
        ? await db
            .select({ id: caseRelationships.id })
            .from(caseRelationships)
            .where(
              or(
                inArray(caseRelationships.sourceCaseId, allCaseIds),
                inArray(caseRelationships.targetCaseId, allCaseIds),
              ),
            )
        : [];
    const remainingTokens = await db
      .select({ id: apiTokens.id })
      .from(apiTokens)
      .where(inArray(apiTokens.organisationId, [orgAId, orgBId]));
    const remainingOrgs = await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(inArray(organisations.id, [orgAId, orgBId]));
    assert.equal(remainingCases.length, 0, "fixture cases must be fully cleaned up");
    assert.equal(remainingRelationships.length, 0, "fixture relationships must be fully cleaned up");
    assert.equal(remainingTokens.length, 0, "fixture api tokens must be fully cleaned up");
    assert.equal(remainingOrgs.length, 0, "fixture orgs must be fully cleaned up");
    console.log("case relationships api fixture cleanup verified: no fixture rows remain");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
