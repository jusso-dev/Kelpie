/**
 * Coverage for post-incident review workflows (issue #64):
 * - policy triggers (severity / classification / org / template)
 * - revision fork after approval
 * - approval binds exact revision fingerprint
 * - knowledge redaction of sensitive fields
 * - follow-ups separate from case_tasks
 * - tenant isolation
 * - case closed while review stays open
 *
 * Uses real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  caseTasks,
  cases,
  organisations,
  reviewFollowUpActions,
  users,
} from "../src/db/schema";
import {
  setCaseVisibility,
  type AccessActor,
} from "../src/lib/access";
import { newId } from "../src/lib/utils";
import { tokenHasScope, SENSITIVE_SCOPES, legacyDefaultScopes } from "../src/lib/scopes";
import {
  buildKnowledgeBody,
  contentFingerprint,
  createFollowUpCore,
  createImprovementCore,
  createReviewCore,
  createReviewTemplateCore,
  decideReviewApprovalCore,
  DEFAULT_ORG_REVIEW_POLICY,
  evaluateReviewRequired,
  getReviewCore,
  listOrgReviewsCore,
  listRevisionsCore,
  normaliseReviewContent,
  publishKnowledgeFromReviewCore,
  redactContentForKnowledge,
  ReviewError,
  reviewOpenWhileCaseClosed,
  reviewReportingSummaryCore,
  saveReviewContentCore,
  seedBaselineReviewTemplates,
  serializeReview,
  setOrgReviewPolicy,
  submitReviewCore,
  updateReviewTemplateCore,
} from "../src/lib/post-incident-review";

const runId = newId("i64").slice("i64_".length).slice(0, 10);
const orgAId = `org_i64a_${runId}`;
const orgBId = `org_i64b_${runId}`;
const userAId = `user_i64a_${runId}`;
const userA2Id = `user_i64a2_${runId}`;
const userBId = `user_i64b_${runId}`;
let caseHigh = "";
let caseLow = "";
let caseRestricted = "";
let caseB = "";

function adminActor(userId: string): AccessActor {
  return {
    organisationId: orgAId,
    userId,
    role: "admin",
    teamIds: [],
  };
}

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "PIR Org A", slug: `i64a-${runId}` },
    { id: orgBId, name: "PIR Org B", slug: `i64b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      name: "Analyst A",
      email: `i64a-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: userA2Id,
      name: "Analyst A2 non-member",
      email: `i64a2-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: userBId,
      name: "Analyst B",
      email: `i64b-${runId}@example.com`,
      organisationId: orgBId,
      role: "admin",
    },
  ]);
  caseHigh = newId("case");
  caseLow = newId("case");
  caseRestricted = newId("case");
  caseB = newId("case");
  await db.insert(cases).values([
    {
      id: caseHigh,
      organisationId: orgAId,
      caseNumber: `I64H-${runId}`,
      title: "Critical ransomware",
      severity: "critical",
      classification: "malware",
      status: "closed",
      closedAt: new Date("2026-01-15T00:00:00.000Z"),
    },
    {
      id: caseLow,
      organisationId: orgAId,
      caseNumber: `I64L-${runId}`,
      title: "Low phishing",
      severity: "low",
      classification: "phishing",
      status: "open",
    },
    {
      id: caseRestricted,
      organisationId: orgAId,
      caseNumber: `I64R-${runId}`,
      title: "Restricted insider case",
      severity: "high",
      classification: "policy_violation",
      status: "open",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `I64B-${runId}`,
      title: "Other org case",
      severity: "critical",
    },
  ]);
}

async function cleanup() {
  await db.delete(organisations).where(eq(organisations.id, orgAId));
  await db.delete(organisations).where(eq(organisations.id, orgBId));
}

// ── pure: scopes ───────────────────────────────────────────────────────

{
  assert.equal(tokenHasScope([], "reviews:read"), false, "empty scopes fail closed");
  assert.equal(tokenHasScope(["reviews:read"], "reviews:write"), false);
  assert.equal(tokenHasScope(["reviews:read"], "reviews:read"), true);
  assert.ok(
    (SENSITIVE_SCOPES as readonly string[]).includes("reviews:admin"),
    "reviews:admin is sensitive",
  );
  assert.ok(
    !legacyDefaultScopes().includes("reviews:admin"),
    "legacy defaults exclude reviews:admin",
  );
  console.log("ok: scopes fail closed + reviews:admin sensitive");
}

// ── pure: policy evaluation ────────────────────────────────────────────

{
  const defaultPol = { ...DEFAULT_ORG_REVIEW_POLICY };
  const high = evaluateReviewRequired(defaultPol, {
    severity: "high",
    classification: "phishing",
  });
  assert.equal(high.required, true);
  assert.ok(high.reasons.some((r) => r.startsWith("severity:high")));

  const low = evaluateReviewRequired(defaultPol, {
    severity: "low",
    classification: "phishing",
  });
  assert.equal(low.required, false);

  const classPol = {
    ...defaultPol,
    requireBySeverities: [] as ("low" | "medium" | "high" | "critical")[],
    requireByClassifications: ["data_breach" as const],
  };
  const breach = evaluateReviewRequired(classPol, {
    severity: "low",
    classification: "data_breach",
  });
  assert.equal(breach.required, true);

  const disabled = evaluateReviewRequired(
    { ...defaultPol, enabled: false },
    { severity: "critical", classification: "malware" },
  );
  assert.equal(disabled.required, false, "disabled org policy skips severity");

  const templateForced = evaluateReviewRequired(
    { ...defaultPol, enabled: false, requireBySeverities: [] },
    { severity: "low", classification: "other" },
    {
      requiredSeverities: ["low"],
      requiredClassifications: [],
      name: "Always low",
    },
  );
  assert.equal(templateForced.required, true, "template severity still applies");

  const all = evaluateReviewRequired(
    { ...defaultPol, requireForAllCases: true },
    { severity: "low", classification: "other" },
  );
  assert.equal(all.required, true);
  console.log("ok: policy triggers severity/classification/template/org");
}

// ── pure: open while case closed ───────────────────────────────────────

{
  const r = reviewOpenWhileCaseClosed({
    caseStatus: "closed",
    reviewStatus: "in_progress",
    requiredByPolicy: true,
  });
  assert.equal(r.caseClosed, true);
  assert.equal(r.reviewOpen, true);
  assert.equal(r.overdueRisk, true);

  const done = reviewOpenWhileCaseClosed({
    caseStatus: "closed",
    reviewStatus: "approved",
    requiredByPolicy: true,
  });
  assert.equal(done.reviewOpen, false);
  assert.equal(done.overdueRisk, false);
  console.log("ok: case may close while review stays open");
}

// ── pure: redaction ────────────────────────────────────────────────────

{
  const secret = "credential dump path /secret/creds.db";
  const content = normaliseReviewContent({
    incidentSummary: "Phishing wave",
    knowledgeSummary: "Train finance on lure detection",
    sensitiveEvidenceNotes: secret,
    restrictedNotes: "VIP mailbox contents",
    themes: ["phishing", "training"],
    whatWorked: ["Fast containment"],
  });
  const redacted = redactContentForKnowledge(content);
  assert.equal(redacted.sensitiveEvidenceNotes, undefined);
  assert.equal(redacted.restrictedNotes, undefined);
  assert.equal(redacted.knowledgeSummary, "Train finance on lure detection");
  assert.ok(!JSON.stringify(redacted).includes(secret));

  const body = buildKnowledgeBody(content, { includeSensitive: false });
  assert.equal(body.includesSensitive, false);
  assert.ok(!JSON.stringify(body).includes(secret));
  assert.ok(!JSON.stringify(body.body).includes("VIP mailbox"));

  const withSens = buildKnowledgeBody(content, { includeSensitive: true });
  assert.equal(withSens.includesSensitive, true);
  assert.ok(JSON.stringify(withSens.body).includes(secret));

  const fp1 = contentFingerprint(content);
  const fp2 = contentFingerprint({ ...content, incidentSummary: "changed" });
  assert.notEqual(fp1, fp2);

  // serializeReview must redact unless includeSensitive
  const fakeView = {
    content,
  } as Parameters<typeof serializeReview>[0];
  // Minimal stub for pure redaction check on content field only
  const redactedDto = serializeReview(
    {
      id: "x",
      organisationId: "o",
      caseId: "c",
      templateId: null,
      templateVersionId: null,
      status: "draft",
      requiredByPolicy: false,
      policyReason: null,
      dueAt: null,
      currentRevisionId: null,
      approvedRevisionId: null,
      title: "t",
      createdBy: null,
      submittedAt: null,
      approvedAt: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      currentRevision: null,
      approvedRevision: null,
      content,
    },
    { includeSensitive: false },
  );
  assert.equal(
    (redactedDto.content as { sensitiveEvidenceNotes?: string })
      .sensitiveEvidenceNotes,
    undefined,
  );
  assert.ok(!JSON.stringify(redactedDto).includes(secret));
  const openDto = serializeReview(
    {
      id: "x",
      organisationId: "o",
      caseId: "c",
      templateId: null,
      templateVersionId: null,
      status: "draft",
      requiredByPolicy: false,
      policyReason: null,
      dueAt: null,
      currentRevisionId: null,
      approvedRevisionId: null,
      title: "t",
      createdBy: null,
      submittedAt: null,
      approvedAt: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      currentRevision: null,
      approvedRevision: null,
      content,
    },
    { includeSensitive: true },
  );
  assert.ok(JSON.stringify(openDto).includes(secret));
  void fakeView;
  console.log("ok: knowledge redaction excludes sensitive by default");
}

// ── DB-backed ──────────────────────────────────────────────────────────

async function main() {
  await setup();
  try {
    // Seed baseline
    const seed1 = await seedBaselineReviewTemplates(orgAId, userAId);
    assert.equal(seed1.created, 1);
    const seed2 = await seedBaselineReviewTemplates(orgAId, userAId);
    assert.equal(seed2.created, 0);
    console.log("ok: baseline review template seeded idempotently");

    await setOrgReviewPolicy(orgAId, {
      enabled: true,
      requireBySeverities: ["high", "critical"],
      requireByClassifications: [],
      requireForAllCases: false,
      dueDaysAfterClose: 7,
    });

    // Critical case → required by policy even though case already closed
    const reviewHigh = await createReviewCore(orgAId, caseHigh, userAId, {
      content: {
        incidentSummary: "Ransomware via phishing",
        knowledgeSummary: "Segment backups",
        sensitiveEvidenceNotes: "KEYMATERIAL-xyz-do-not-publish",
        themes: ["ransomware", "backup"],
      },
    });
    assert.equal(reviewHigh.requiredByPolicy, true);
    assert.equal(reviewHigh.status, "draft");
    assert.ok(reviewHigh.dueAt, "due date set for required review");
    assert.ok(reviewHigh.openWhileCaseClosed?.caseClosed);
    assert.ok(reviewHigh.openWhileCaseClosed?.reviewOpen);
    assert.ok(reviewHigh.openWhileCaseClosed?.overdueRisk);
    console.log("ok: required review on closed high-severity case");

    // Low case → not required by default
    const reviewLow = await createReviewCore(orgAId, caseLow, userAId, {});
    assert.equal(reviewLow.requiredByPolicy, false);
    console.log("ok: low severity not required by default policy");

    // Save content on draft (in-place)
    const rev1Id = reviewHigh.currentRevision!.id;
    const updated = await saveReviewContentCore(orgAId, reviewHigh.id, userAId, {
      incidentSummary: "Ransomware via phishing — updated",
      knowledgeSummary: "Segment backups and MFA",
      rootCause: "No MFA on VPN",
      sensitiveEvidenceNotes: "KEYMATERIAL-xyz-do-not-publish",
      themes: ["ransomware", "backup", "mfa"],
    });
    assert.equal(updated.currentRevision!.id, rev1Id, "draft updates in place");
    assert.equal(updated.status, "in_progress");
    console.log("ok: draft content updates in place");

    // Submit + approve
    const submitted = await submitReviewCore(orgAId, reviewHigh.id, userAId);
    assert.equal(submitted.status, "pending_approval");
    const boundFp = submitted.currentRevision!.contentFingerprint;

    const approved = await decideReviewApprovalCore(
      orgAId,
      reviewHigh.id,
      userAId,
      "approved",
      "Looks good",
    );
    assert.equal(approved.status, "approved");
    assert.equal(approved.currentRevision!.isApproved, true);
    assert.equal(
      approved.currentRevision!.boundContentFingerprint,
      boundFp,
      "approval binds exact fingerprint",
    );
    assert.equal(approved.approvedRevisionId, approved.currentRevision!.id);
    assert.ok(approved.currentRevision!.approvedBy === userAId);
    assert.ok(approved.currentRevision!.approvedAt);
    console.log("ok: approval binds exact revision + fingerprint");

    // Edit after approval → new unapproved revision
    const forked = await saveReviewContentCore(orgAId, reviewHigh.id, userAId, {
      incidentSummary: "Ransomware via phishing — post-approval edit",
      knowledgeSummary: "Segment backups and MFA",
      rootCause: "No MFA on VPN + stale VPN client",
      sensitiveEvidenceNotes: "KEYMATERIAL-xyz-do-not-publish",
      themes: ["ransomware", "backup", "mfa"],
    });
    assert.notEqual(forked.currentRevision!.id, rev1Id);
    assert.equal(forked.currentRevision!.isApproved, false);
    assert.equal(forked.status, "in_progress");
    assert.equal(forked.approvedRevisionId, rev1Id, "prior approved revision retained");
    const revisions = await listRevisionsCore(orgAId, reviewHigh.id, userAId);
    assert.ok(revisions.length >= 2);
    assert.ok(revisions.some((r) => r.isApproved && r.id === rev1Id));
    // Org-mode case: actor has view_sensitive so revision content retains notes.
    assert.ok(
      revisions.some(
        (r) =>
          typeof r.content.sensitiveEvidenceNotes === "string" &&
          r.content.sensitiveEvidenceNotes.includes("KEYMATERIAL"),
      ),
    );
    console.log("ok: edit of approved review creates new unapproved revision");

    // Follow-ups separate from case_tasks
    const fu = await createFollowUpCore(orgAId, reviewHigh.id, userAId, {
      title: "Enable MFA on VPN",
      ownerId: userAId,
      dueAt: new Date("2026-02-01T00:00:00.000Z").toISOString(),
      theme: "mfa",
      externalTicketRef: "JIRA-123",
    });
    assert.equal(fu.status, "open");
    assert.equal(fu.reviewId, reviewHigh.id);
    assert.equal(fu.caseId, caseHigh);
    // Cross-org owner rejected
    await assert.rejects(
      () =>
        createFollowUpCore(orgAId, reviewHigh.id, userAId, {
          title: "Bad owner",
          ownerId: userBId,
        }),
      (err: unknown) =>
        err instanceof ReviewError &&
        err.message.includes("Owner must belong"),
    );
    // Ensure no case_task was created for this follow-up
    const tasks = await db
      .select()
      .from(caseTasks)
      .where(eq(caseTasks.caseId, caseHigh));
    assert.ok(
      !tasks.some((t) => t.title === "Enable MFA on VPN"),
      "follow-ups must not write case_tasks",
    );
    const fuRows = await db
      .select()
      .from(reviewFollowUpActions)
      .where(eq(reviewFollowUpActions.id, fu.id));
    assert.equal(fuRows.length, 1);
    console.log("ok: follow-ups have separate lifecycle from case_tasks");

    // Improvements
    const imp = await createImprovementCore(orgAId, reviewHigh.id, userAId, {
      kind: "detection_improvement",
      title: "Alert on VPN auth without MFA",
      description: "Add SIEM correlation",
    });
    assert.equal(imp.kind, "detection_improvement");
    assert.equal(imp.status, "proposed");
    // Foreign playbook id rejected
    await assert.rejects(
      () =>
        createImprovementCore(orgAId, reviewHigh.id, userAId, {
          kind: "playbook_revision",
          title: "Bad playbook",
          linkedPlaybookId: "pb_does_not_exist_cross_org",
        }),
      (err: unknown) =>
        err instanceof ReviewError && err.message.includes("Playbook not found"),
    );
    console.log("ok: detection improvement proposal linked to review");

    // Knowledge redaction
    const article = await publishKnowledgeFromReviewCore(
      orgAId,
      reviewHigh.id,
      userAId,
      { includeSensitive: false },
    );
    assert.equal(article.includesSensitive, false);
    assert.ok(!article.summary.includes("KEYMATERIAL"));
    assert.ok(
      !JSON.stringify(article.body).includes("KEYMATERIAL"),
      "knowledge body must not contain sensitive notes by default",
    );
    assert.equal(article.sourceReviewId, reviewHigh.id);
    assert.equal(article.sourceCaseId, caseHigh);
    console.log("ok: knowledge excludes sensitive evidence by default");

    // Tenant isolation: org B cannot load org A review via get
    const cross = await getReviewCore(orgBId, reviewHigh.id, userBId);
    assert.equal(cross, null, "tenant isolation on getReviewCore");

    // Org B templates/reviews isolated
    await seedBaselineReviewTemplates(orgBId, userBId);
    const bReview = await createReviewCore(orgBId, caseB, userBId, {
      content: { incidentSummary: "B only" },
    });
    assert.equal(bReview.organisationId, orgBId);
    const aSeeB = await getReviewCore(orgAId, bReview.id, userAId);
    assert.equal(aSeeB, null);
    console.log("ok: tenant isolation for reviews");

    // Template versioning
    const custom = await createReviewTemplateCore(orgAId, userAId, {
      name: "Regulatory post-incident",
      requiredSeverities: ["critical"],
      requiredClassifications: ["data_breach"],
    });
    assert.equal(custom.currentVersion, 1);
    const bumped = await updateReviewTemplateCore(
      orgAId,
      custom.id,
      userAId,
      {
        sections: [
          {
            key: "incident_summary",
            required: true,
            order: 0,
          },
          {
            key: "knowledge_summary",
            required: true,
            order: 1,
          },
        ],
      },
    );
    assert.equal(bumped.currentVersion, 2);
    console.log("ok: review template immutable versioning");

    // Reporting summary
    const summary = await reviewReportingSummaryCore(orgAId, userAId);
    assert.ok(typeof summary.openRequiredReviews === "number");
    assert.ok(summary.openFollowUps >= 1);
    assert.ok(
      summary.improvementByKind.some((k) => k.kind === "detection_improvement"),
    );
    console.log("ok: reporting summary includes overdue/open/themes/improvements");

    // Reject path
    const toReject = await createReviewCore(orgAId, caseLow, userAId, {
      content: {
        incidentSummary: "Reject me",
        knowledgeSummary: "n/a",
      },
    });
    await submitReviewCore(orgAId, toReject.id, userAId);
    const rejected = await decideReviewApprovalCore(
      orgAId,
      toReject.id,
      userAId,
      "rejected",
      "Needs more root cause",
    );
    assert.equal(rejected.status, "in_progress");
    assert.equal(rejected.currentRevision!.approvalDecision, "rejected");
    assert.equal(rejected.currentRevision!.isApproved, false);
    console.log("ok: reject returns review to in_progress");

    // Approve requires pending_approval (CAS guard)
    await assert.rejects(
      () =>
        decideReviewApprovalCore(
          orgAId,
          toReject.id,
          userAId,
          "approved",
        ),
      (err: unknown) =>
        err instanceof ReviewError &&
        err.status === 409 &&
        err.message.includes("not pending approval"),
    );
    console.log("ok: approve rejected when status is not pending_approval");

    // ── Compartment: restricted case hides reviews from non-members ──
    // Create review while case is still organisation-visible, then restrict.
    const restrictedReview = await createReviewCore(
      orgAId,
      caseRestricted,
      userAId,
      {
        content: {
          incidentSummary: "Insider review",
          knowledgeSummary: "Need-to-know only",
          sensitiveEvidenceNotes: "RESTRICTED-SECRET-NOTES",
          restrictedNotes: "VIP only notes",
        },
      },
    );
    await setCaseVisibility(orgAId, adminActor(userAId), caseRestricted, {
      visibilityMode: "restricted",
      reason: "PIR compartment test",
    });

    // Non-member analyst with reviews:read semantics cannot get the review.
    const deniedGet = await getReviewCore(
      orgAId,
      restrictedReview.id,
      userA2Id,
    );
    assert.equal(
      deniedGet,
      null,
      "non-member must not load review on restricted case",
    );

    // Org-wide list drops unauthorized rows.
    const listed = await listOrgReviewsCore(orgAId, userA2Id, { limit: 100 });
    assert.ok(
      !listed.some((r) => r.id === restrictedReview.id),
      "org list must drop reviews on restricted cases for non-members",
    );

    // Creator still has no view_metadata as admin-only know_exists on restricted
    // without grant — admin may administer but not auto-view. userAId is admin
    // so know_exists yes, view_metadata no without grant.
    const adminGet = await getReviewCore(
      orgAId,
      restrictedReview.id,
      userAId,
    );
    assert.equal(
      adminGet,
      null,
      "admin without compartment grant must not view_metadata review content",
    );

    // Revisions list also 404s for non-member
    await assert.rejects(
      () => listRevisionsCore(orgAId, restrictedReview.id, userA2Id),
      (err: unknown) => err instanceof ReviewError && err.status === 404,
    );
    console.log(
      "ok: compartment deny on restricted case for non-member reviews:read",
    );

    console.log("\nAll post-incident review tests passed.");
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
