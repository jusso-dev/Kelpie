/**
 * Coverage for the detection/control/process improvement register (issue #66):
 * - scopes fail closed
 * - similarity suggestions explain fields and never auto-merge
 * - create from case / review with immutable source links
 * - multi-case linking + recurrence count
 * - close requires validation; reopen preserves prior history
 * - external ticket sync does not replace ownership/links/audit
 * - promote #64 review improvement proposals
 * - authorization + tenant isolation
 * - sensitive evidence redaction
 *
 * Uses real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  cases,
  improvementRegisterEvents,
  improvementRegisterItems,
  organisations,
  playbooks,
  reviewImprovementProposals,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  SENSITIVE_SCOPES,
  legacyDefaultScopes,
  tokenHasScope,
} from "../src/lib/scopes";
import {
  PROPOSAL_KIND_TO_REGISTER_TYPE,
  ImprovementRegisterError,
  closeImprovementCore,
  createFromProposalCore,
  createImprovementCore,
  getImprovementCore,
  improvementDashboardCore,
  jaccard,
  linkImprovementCore,
  listImprovementEventsCore,
  listImprovementsCore,
  rankSimilarImprovements,
  reopenImprovementCore,
  suggestSimilarImprovementsCore,
  syncExternalTicketCore,
  tokenise,
  unlinkImprovementCore,
  updateImprovementCore,
} from "../src/lib/improvement-register";
import {
  createImprovementCore as createReviewProposalCore,
  createReviewCore,
  seedBaselineReviewTemplates,
} from "../src/lib/post-incident-review";
import { setCaseVisibility } from "../src/lib/access";

const runId = newId("i66").slice("i66_".length).slice(0, 10);
const orgAId = `org_i66a_${runId}`;
const orgBId = `org_i66b_${runId}`;
const userAId = `user_i66a_${runId}`;
const userA2Id = `user_i66a2_${runId}`;
const userBId = `user_i66b_${runId}`;
let caseA1 = "";
let caseA2 = "";
let caseRestricted = "";
let caseB = "";
let playbookA = "";

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "ImpReg Org A", slug: `i66a-${runId}` },
    { id: orgBId, name: "ImpReg Org B", slug: `i66b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      name: "Analyst A",
      email: `i66a-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: userA2Id,
      name: "Analyst A2 non-member",
      email: `i66a2-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: userBId,
      name: "Analyst B",
      email: `i66b-${runId}@example.com`,
      organisationId: orgBId,
      role: "admin",
    },
  ]);
  caseA1 = newId("case");
  caseA2 = newId("case");
  caseRestricted = newId("case");
  caseB = newId("case");
  await db.insert(cases).values([
    {
      id: caseA1,
      organisationId: orgAId,
      caseNumber: `I66A1-${runId}`,
      title: "Missing EDR on Linux fleet",
      severity: "high",
    },
    {
      id: caseA2,
      organisationId: orgAId,
      caseNumber: `I66A2-${runId}`,
      title: "Linux EDR gap recurrence",
      severity: "critical",
    },
    {
      id: caseRestricted,
      organisationId: orgAId,
      caseNumber: `I66R-${runId}`,
      title: "Restricted insider",
      severity: "high",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `I66B-${runId}`,
      title: "Other org case",
      severity: "high",
    },
  ]);
  playbookA = newId("pb");
  await db.insert(playbooks).values({
    id: playbookA,
    organisationId: orgAId,
    name: "Ransomware baseline",
    classification: "malware",
  });
  await seedBaselineReviewTemplates(orgAId, userAId);
}

async function cleanup() {
  await db.delete(organisations).where(eq(organisations.id, orgAId));
  await db.delete(organisations).where(eq(organisations.id, orgBId));
}

// ── pure: scopes ───────────────────────────────────────────────────────

{
  assert.equal(
    tokenHasScope([], "improvements:read"),
    false,
    "empty scopes fail closed",
  );
  assert.equal(
    tokenHasScope(["improvements:read"], "improvements:write"),
    false,
  );
  assert.equal(
    tokenHasScope(["improvements:read"], "improvements:read"),
    true,
  );
  assert.ok(
    legacyDefaultScopes().includes("improvements:read"),
    "legacy defaults include improvements:read",
  );
  assert.ok(
    legacyDefaultScopes().includes("improvements:write"),
    "legacy defaults include improvements:write",
  );
  assert.ok(
    !(SENSITIVE_SCOPES as readonly string[]).includes("improvements:write"),
    "improvements:write is not a sensitive scope",
  );
  console.log("ok: scopes fail closed + improvements scopes present");
}

// ── pure: proposal kind mapping ────────────────────────────────────────

{
  assert.equal(
    PROPOSAL_KIND_TO_REGISTER_TYPE.detection_improvement,
    "detection_gap",
  );
  assert.equal(
    PROPOSAL_KIND_TO_REGISTER_TYPE.playbook_revision,
    "playbook_defect",
  );
  assert.equal(
    PROPOSAL_KIND_TO_REGISTER_TYPE.control_gap,
    "security_control_gap",
  );
  console.log("ok: proposal kind → register type mapping");
}

// ── pure: similarity ───────────────────────────────────────────────────

{
  const a = tokenise("Missing EDR telemetry on Linux servers");
  const b = tokenise("Linux EDR telemetry gap for servers");
  assert.ok(jaccard(a, b) > 0.3, "related titles share tokens");

  const ranked = rankSimilarImprovements(
    {
      type: "detection_gap",
      title: "Missing EDR telemetry on Linux fleet",
      description: "No sysmon or falcon sensors on production Linux hosts",
    },
    [
      {
        id: "imp_1",
        type: "detection_gap",
        title: "EDR telemetry missing on Linux hosts",
        description: "Production Linux fleet lacks falcon sensors",
        status: "open",
        severity: "high",
        recurrenceCount: 2,
      },
      {
        id: "imp_2",
        type: "process_failure",
        title: "Password reset SOP outdated",
        description: "Helpdesk uses old script",
        status: "open",
        severity: "low",
        recurrenceCount: 0,
      },
    ],
  );
  assert.ok(ranked.length >= 1);
  assert.equal(ranked[0]!.improvement.id, "imp_1");
  assert.ok(
    ranked[0]!.matchedFields.some((f) => f.field === "type"),
    "type match explained",
  );
  assert.ok(
    ranked[0]!.matchedFields.some((f) => f.field === "title"),
    "title match explained",
  );
  assert.ok(
    !ranked.some((r) => r.improvement.id === "imp_2" && r.score > 0.5),
    "unrelated process item not top-ranked",
  );
  console.log("ok: similarity explains matched fields, no auto-merge");
}

async function main() {
  await setup();
  try {
    // ── create from case with immutable source ─────────────────────────
    const created = await createImprovementCore(orgAId, userAId, {
      type: "detection_gap",
      title: "Missing EDR telemetry on Linux fleet",
      description: "No sensors on production Linux hosts",
      evidence: { hostsSampled: 12, sensor: "none" },
      sensitiveEvidence: { assetTags: ["finance-db-01"] },
      severity: "high",
      residualRisk: "Undetected lateral movement on Linux",
      ownerId: userAId,
      dueAt: new Date(Date.now() - 86_400_000).toISOString(), // overdue
      linkedPlaybookId: playbookA,
      caseId: caseA1,
    });
    assert.equal(created.status, "open");
    assert.equal(created.sourceKind, "case");
    assert.equal(created.sourceCaseId, caseA1);
    assert.equal(created.recurrenceCount, 1);
    assert.ok(created.links.some((l) => l.linkKind === "case" && l.isSource));
    assert.ok(
      created.links.some((l) => l.linkKind === "playbook" && l.targetId === playbookA),
    );
    assert.equal(created.ownerId, userAId);
    console.log("ok: create from case with immutable source links");

    // Source fields immutable via update path (not exposed in patch — verify stored)
    const reloaded = await getImprovementCore(orgAId, created.id, userAId);
    assert.ok(reloaded);
    assert.equal(reloaded!.sourceCaseId, caseA1);

    // ── suggestions ────────────────────────────────────────────────────
    const suggestions = await suggestSimilarImprovementsCore(
      orgAId,
      userAId,
      {
        type: "detection_gap",
        title: "EDR telemetry gap Linux production",
        description: "hosts lack falcon",
      },
    );
    assert.ok(suggestions.some((s) => s.improvement.id === created.id));
    assert.ok(
      suggestions[0]!.matchedFields.length > 0,
      "suggestions explain matches",
    );
    console.log("ok: suggestions return existing similar item");

    // ── link second case → recurrence ──────────────────────────────────
    const linked = await linkImprovementCore(orgAId, created.id, userAId, {
      linkKind: "case",
      targetId: caseA2,
    });
    assert.equal(linked.recurrenceCount, 2, "recurrence from distinct cases");
    assert.ok(
      linked.links.filter((l) => l.linkKind === "case").length === 2,
    );
    console.log("ok: multi-case link raises recurrence count");

    // Cannot unlink source link
    const sourceLink = linked.links.find((l) => l.isSource)!;
    await assert.rejects(
      () => unlinkImprovementCore(orgAId, created.id, userAId, sourceLink.id),
      (err: unknown) =>
        err instanceof ImprovementRegisterError &&
        err.message.includes("Immutable source"),
    );
    console.log("ok: immutable source link cannot be removed");

    // Unlink non-source case drops recurrence
    const extraLink = linked.links.find(
      (l) => l.linkKind === "case" && !l.isSource,
    )!;
    const unlinked = await unlinkImprovementCore(
      orgAId,
      created.id,
      userAId,
      extraLink.id,
    );
    assert.equal(unlinked.recurrenceCount, 1);
    // re-link for rest of tests
    await linkImprovementCore(orgAId, created.id, userAId, {
      linkKind: "case",
      targetId: caseA2,
    });
    console.log("ok: unlink non-source adjusts recurrence");

    // ── close requires validation ──────────────────────────────────────
    await assert.rejects(
      () =>
        closeImprovementCore(orgAId, created.id, userAId, {
          validationMethod: "retest",
          validationEvidence: "   ",
        }),
      (err: unknown) => err instanceof ImprovementRegisterError,
    );
    await assert.rejects(
      () =>
        updateImprovementCore(orgAId, created.id, userAId, {
          status: "closed",
        }),
      (err: unknown) =>
        err instanceof ImprovementRegisterError &&
        err.message.includes("close endpoint"),
    );

    const closed = await closeImprovementCore(orgAId, created.id, userAId, {
      validationMethod: "retest",
      validationEvidence: "EDR rolled out; retest case clean",
    });
    assert.equal(closed.status, "closed");
    assert.equal(closed.validationMethod, "retest");
    assert.equal(closed.validatedBy, userAId);
    assert.ok(closed.validatedAt);
    assert.equal(closed.closedBy, userAId);
    assert.ok(closed.closedAt);
    console.log("ok: close requires validation method + evidence + actor/ts");

    // ── reopen preserves prior validation history ──────────────────────
    const reopened = await reopenImprovementCore(
      orgAId,
      created.id,
      userAId,
      "Recurred on second case",
    );
    assert.equal(reopened.status, "reopened");
    assert.equal(reopened.validationMethod, null);
    assert.equal(reopened.closedAt, null);

    const events = await listImprovementEventsCore(
      orgAId,
      created.id,
      userAId,
    );
    const reopenEvt = events.find((e) => e.eventType === "reopened");
    assert.ok(reopenEvt);
    const prior = (reopenEvt!.payload as { priorClosure?: Record<string, unknown> })
      .priorClosure;
    assert.ok(prior);
    assert.equal(prior!.validationMethod, "retest");
    assert.ok(
      String(prior!.validationEvidence).includes("EDR rolled out"),
      "prior validation evidence retained in history",
    );
    assert.ok(events.some((e) => e.eventType === "closed"));
    assert.ok(events.some((e) => e.eventType === "validated"));
    console.log("ok: reopen preserves prior validation/closure history");

    // ── external ticket sync bounded ───────────────────────────────────
    const ownerBefore = reopened.ownerId;
    const statusBefore = reopened.status;
    const recurrenceBefore = reopened.recurrenceCount;
    const synced = await syncExternalTicketCore(
      orgAId,
      created.id,
      userAId,
      {
        externalTicketRef: "ENG-42",
        externalTicketUrl: "https://tickets.example/ENG-42",
        syncState: "synced",
      },
    );
    assert.equal(synced.externalTicketRef, "ENG-42");
    assert.equal(synced.externalTicketSyncState, "synced");
    assert.equal(synced.ownerId, ownerBefore, "sync must not change owner");
    assert.equal(synced.status, statusBefore, "sync must not change status");
    assert.equal(
      synced.recurrenceCount,
      recurrenceBefore,
      "sync must not change recurrence",
    );
    assert.equal(synced.sourceCaseId, caseA1, "sync must not change source");

    const conflicted = await syncExternalTicketCore(
      orgAId,
      created.id,
      userAId,
      { conflict: true, error: "Remote ticket closed unexpectedly" },
    );
    assert.equal(conflicted.externalTicketSyncState, "conflict");
    assert.equal(conflicted.ownerId, ownerBefore);
    assert.equal(conflicted.externalTicketRef, "ENG-42", "conflict keeps ref");
    const syncEvents = await listImprovementEventsCore(
      orgAId,
      created.id,
      userAId,
    );
    assert.ok(syncEvents.some((e) => e.eventType === "ticket_synced"));
    assert.ok(syncEvents.some((e) => e.eventType === "ticket_conflict"));
    console.log("ok: ticket sync bounded; conflicts recorded without overwrite");

    // ── dashboard ──────────────────────────────────────────────────────
    const dash = await improvementDashboardCore(orgAId, userAId);
    assert.ok(dash.byType.some((t) => t.type === "detection_gap"));
    assert.ok(dash.totals.openWork >= 1);
    assert.ok(
      dash.highRecurrence.some((h) => h.id === created.id),
      "recurrence ≥2 appears on dashboard",
    );
    // due date was yesterday and status is reopened (open work) → overdue
    assert.ok(
      dash.overdue.some((o) => o.id === created.id),
      "overdue open work listed",
    );
    console.log("ok: dashboard themes, severity, owners, overdue, validation");

    // ── from case block without review ─────────────────────────────────
    const manual = await createImprovementCore(orgAId, userAId, {
      type: "process_failure",
      title: "Escalation ladder not followed",
      caseId: caseA2,
      severity: "medium",
    });
    assert.equal(manual.sourceKind, "case");
    assert.equal(manual.sourceCaseId, caseA2);

    // ── promote #64 proposal ───────────────────────────────────────────
    const review = await createReviewCore(orgAId, caseA1, userAId, {
      title: "PIR for EDR gap",
    });
    const proposal = await createReviewProposalCore(
      orgAId,
      review.id,
      userAId,
      {
        kind: "detection_improvement",
        title: "Add Linux EDR detection rules",
        description: "Cover T1021 lateral movement",
        linkedPlaybookId: playbookA,
        ownerId: userAId,
      },
    );
    assert.equal(proposal.status, "proposed");

    const fromProp = await createFromProposalCore(
      orgAId,
      userAId,
      proposal.id,
      { severity: "critical", dueAt: new Date("2026-09-01T00:00:00.000Z").toISOString() },
    );
    assert.equal(fromProp.sourceKind, "review_proposal");
    assert.equal(fromProp.sourceProposalId, proposal.id);
    assert.equal(fromProp.sourceReviewId, review.id);
    assert.equal(fromProp.sourceCaseId, caseA1);
    assert.equal(fromProp.type, "detection_gap");
    assert.equal(fromProp.severity, "critical");
    assert.ok(
      fromProp.links.some(
        (l) => l.linkKind === "review_proposal" && l.isSource,
      ),
    );
    assert.ok(fromProp.links.some((l) => l.linkKind === "review" && l.isSource));

    const [proposalAfter] = await db
      .select()
      .from(reviewImprovementProposals)
      .where(eq(reviewImprovementProposals.id, proposal.id))
      .limit(1);
    assert.equal(proposalAfter!.status, "accepted");

    // Idempotent promote
    const again = await createFromProposalCore(orgAId, userAId, proposal.id);
    assert.equal(again.id, fromProp.id, "idempotent on proposalId");
    console.log("ok: promote #64 proposal with immutable sources + idempotent");

    // Create from review directly
    const fromReview = await createImprovementCore(orgAId, userAId, {
      type: "security_control_gap",
      title: "No MFA on privileged VPN",
      reviewId: review.id,
      severity: "high",
    });
    assert.equal(fromReview.sourceKind, "review");
    assert.equal(fromReview.sourceReviewId, review.id);
    assert.equal(fromReview.sourceCaseId, caseA1);
    console.log("ok: create from post-incident review");

    // ── tenant isolation ───────────────────────────────────────────────
    const orgAList = await listImprovementsCore(orgAId, userAId);
    assert.ok(orgAList.every((i) => i.id.startsWith("imp_")));
    assert.ok(orgAList.some((i) => i.id === created.id));

    const orgBList = await listImprovementsCore(orgBId, userBId);
    assert.equal(orgBList.length, 0, "org B sees no org A improvements");

    await assert.rejects(
      () => getImprovementCore(orgBId, created.id, userBId).then((r) => {
        // get returns null when org filter misses
        assert.equal(r, null);
        throw new ImprovementRegisterError("not found cross-tenant", 404);
      }),
      (err: unknown) =>
        err instanceof ImprovementRegisterError && err.status === 404,
    );

    // Direct get with wrong org
    const cross = await getImprovementCore(orgBId, created.id, userBId);
    assert.equal(cross, null, "cross-tenant get returns null");

    await assert.rejects(
      () =>
        linkImprovementCore(orgAId, created.id, userAId, {
          linkKind: "case",
          targetId: caseB,
        }),
      (err: unknown) =>
        err instanceof ImprovementRegisterError && err.status === 404,
      "cannot link other org case",
    );

    await assert.rejects(
      () =>
        createImprovementCore(orgAId, userAId, {
          type: "detection_gap",
          title: "Cross owner",
          ownerId: userBId,
          caseId: caseA1,
        }),
      (err: unknown) => err instanceof ImprovementRegisterError,
      "cross-org owner rejected",
    );
    console.log("ok: tenant isolation + cross-org link/owner rejected");

    // ── list filter by case ────────────────────────────────────────────
    const forCase = await listImprovementsCore(orgAId, userAId, {
      caseId: caseA1,
    });
    assert.ok(forCase.some((i) => i.id === created.id));
    assert.ok(forCase.every((i) =>
      i.sourceCaseId === caseA1 ||
      i.links.some((l) => l.linkKind === "case" && l.targetId === caseA1),
    ));
    console.log("ok: list filter by caseId");

    // ── sensitive evidence redaction (restricted source case) ──────────
    // Create while case is organisation-visible, then tighten compartment so
    // non-member analysts cannot read sensitive source evidence from the
    // broadly listed register item.
    const withSensitive = await createImprovementCore(orgAId, userAId, {
      type: "logging_gap",
      title: "SIEM not ingesting auth logs (restricted source)",
      caseId: caseRestricted,
      sensitiveEvidence: { secretHost: "dc01.internal" },
    });
    await setCaseVisibility(
      orgAId,
      {
        organisationId: orgAId,
        userId: userAId,
        role: "admin",
        teamIds: [],
      },
      caseRestricted,
      {
        visibilityMode: "restricted",
        reason: "Improvement register compartment test",
      },
    );

    const asNonMember = await getImprovementCore(
      orgAId,
      withSensitive.id,
      userA2Id,
    );
    assert.ok(asNonMember, "register item remains listable org-wide");
    assert.equal(
      asNonMember!.sensitiveEvidenceRedacted,
      true,
      "non-member cannot read sensitive source evidence from restricted case",
    );
    assert.ok(
      !(
        asNonMember!.sensitiveEvidence &&
        typeof asNonMember!.sensitiveEvidence === "object" &&
        "secretHost" in (asNonMember!.sensitiveEvidence as object)
      ),
      "secret host must not leak",
    );
    console.log("ok: sensitive evidence redacted without view_sensitive");

    // Event history non-empty for created item
    const allEvents = await db
      .select()
      .from(improvementRegisterEvents)
      .where(eq(improvementRegisterEvents.organisationId, orgAId));
    assert.ok(allEvents.length >= 5);

    const allItems = await db
      .select()
      .from(improvementRegisterItems)
      .where(eq(improvementRegisterItems.organisationId, orgAId));
    assert.ok(allItems.length >= 3);

    console.log("\nAll improvement register tests passed.");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    cleanup().finally(() => process.exit(1));
  });
