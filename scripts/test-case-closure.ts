/**
 * Coverage for configurable case closure (issue #57):
 * - pure evaluation of every requirement type
 * - policy versioning (edits do not rewrite historical versions)
 * - close / override / reopen with version checks
 * - authorization (override permission)
 * - tenant isolation
 *
 * Uses a real Postgres via DATABASE_URL (mirrors test-investigations-core).
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  alertSources,
  alerts,
  caseAlerts,
  caseClosurePolicies,
  caseClosurePolicyVersions,
  caseTasks,
  cases,
  customFieldDefinitions,
  customFieldValues,
  evidenceItems,
  organisations,
  timelineEvents,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  evaluateClosureRequirements,
  type ClosureEvaluationContext,
} from "../src/lib/closure/evaluate";
import {
  createClosurePolicyCore,
  updateClosurePolicyCore,
} from "../src/lib/closure/policy-core";
import {
  closeCaseCore,
  listClosureSnapshotsCore,
  reopenCaseCore,
} from "../src/lib/closure/close-core";
import {
  ClosureOverrideError,
  ClosurePathError,
  ClosureRequirementsError,
  type ClosureDispositionInput,
  type ClosureRequirementConfig,
} from "../src/lib/closure/types";
import { CaseVersionConflictError } from "../src/lib/cases-errors";
import { setCaseStatusCore } from "../src/lib/cases-core";

const runId = newId("i57").slice("i57_".length).slice(0, 10);
const orgAId = `org_i57_a_${runId}`;
const orgBId = `org_i57_b_${runId}`;
const adminAId = `user_i57_admin_${runId}`;
const analystAId = `user_i57_analyst_${runId}`;
const adminBId = `user_i57_badmin_${runId}`;

function baseCtx(
  overrides: Partial<ClosureEvaluationContext> = {},
): ClosureEvaluationContext {
  return {
    case: {
      id: "case_x",
      organisationId: orgAId,
      status: "in_progress",
      severity: "medium",
      classification: "phishing",
      templateId: null,
      containedAt: null,
      eradicatedAt: null,
      resolvedAt: null,
      closedAt: null,
    },
    tasks: [],
    customFields: [],
    alerts: [],
    evidenceItems: [],
    openResponseActions: [],
    relatedHighSeverity: [],
    ...overrides,
  };
}

const baseInput: ClosureDispositionInput = {
  disposition: "resolved",
  conclusion: "Investigation complete.",
};

function evalReqs(
  requirements: ClosureRequirementConfig[],
  ctx: ClosureEvaluationContext,
  input: ClosureDispositionInput = baseInput,
) {
  return evaluateClosureRequirements(requirements, ctx, input, {
    policyId: "pol",
    policyVersionId: "ver",
    policyVersion: 1,
    policyName: "test",
    requireTwoPersonOverride: false,
  });
}

// ── Pure evaluation: every requirement type ─────────────────────────────

{
  const r = evalReqs([{ type: "required_tasks_complete" }], baseCtx({
    tasks: [
      { id: "t1", title: "Contain host", status: "done", isRequired: true },
      { id: "t2", title: "Optional note", status: "todo", isRequired: false },
    ],
  }));
  assert.equal(r.ok, true);
  const fail = evalReqs([{ type: "required_tasks_complete" }], baseCtx({
    tasks: [{ id: "t1", title: "Contain host", status: "todo", isRequired: true }],
  }));
  assert.equal(fail.ok, false);
  assert.deepEqual(fail.failed[0]?.missing, ["Contain host"]);
  console.log("ok: required_tasks_complete");
}

{
  const r = evalReqs(
    [{ type: "required_custom_fields" }],
    baseCtx({
      customFields: [
        { key: "bu", label: "BU", required: true, value: "Finance" },
        { key: "opt", label: "Opt", required: false, value: null },
      ],
    }),
  );
  assert.equal(r.ok, true);
  const fail = evalReqs(
    [{ type: "required_custom_fields", fieldKeys: ["ticket"] }],
    baseCtx({
      customFields: [{ key: "ticket", label: "Ticket", required: false, value: "" }],
    }),
  );
  assert.equal(fail.ok, false);
  assert.ok(fail.failed[0]?.missing.includes("ticket"));
  console.log("ok: required_custom_fields");
}

{
  const r = evalReqs([{ type: "alerts_dispositioned" }], baseCtx({
    alerts: [
      { id: "a1", title: "A", status: "closed", determination: "true_positive" },
    ],
  }));
  assert.equal(r.ok, true);
  const fail = evalReqs([{ type: "alerts_dispositioned" }], baseCtx({
    alerts: [{ id: "a1", title: "Open alert", status: "new", determination: "unknown" }],
  }));
  assert.equal(fail.ok, false);
  console.log("ok: alerts_dispositioned");
}

{
  const r = evalReqs([{ type: "evidence_verdicts" }], baseCtx({
    evidenceItems: [{ id: "e1", type: "hash", value: "abc", verdict: "malicious" }],
  }));
  assert.equal(r.ok, true);
  const fail = evalReqs([{ type: "evidence_verdicts" }], baseCtx({
    evidenceItems: [{ id: "e1", type: "hash", value: "abc", verdict: "unknown" }],
  }));
  assert.equal(fail.ok, false);
  console.log("ok: evidence_verdicts");
}

{
  assert.equal(
    evalReqs([{ type: "containment_recorded" }], baseCtx({
      case: { ...baseCtx().case, containedAt: new Date() },
    })).ok,
    true,
  );
  assert.equal(evalReqs([{ type: "containment_recorded" }], baseCtx()).ok, false);
  console.log("ok: containment_recorded");
}

{
  assert.equal(
    evalReqs([{ type: "eradication_recorded" }], baseCtx({
      case: { ...baseCtx().case, eradicatedAt: new Date() },
    })).ok,
    true,
  );
  assert.equal(evalReqs([{ type: "eradication_recorded" }], baseCtx()).ok, false);
  console.log("ok: eradication_recorded");
}

{
  assert.equal(
    evalReqs([{ type: "recovery_recorded" }], baseCtx({
      case: { ...baseCtx().case, resolvedAt: new Date() },
    })).ok,
    true,
  );
  assert.equal(evalReqs([{ type: "recovery_recorded" }], baseCtx()).ok, false);
  console.log("ok: recovery_recorded");
}

{
  assert.equal(evalReqs([{ type: "disposition" }], baseCtx()).ok, true);
  assert.equal(
    evalReqs([{ type: "disposition" }], baseCtx(), {
      disposition: "",
      conclusion: "",
    }).ok,
    false,
  );
  console.log("ok: disposition");
}

{
  assert.equal(
    evalReqs([{ type: "root_cause_and_conclusion" }], baseCtx(), {
      disposition: "resolved",
      conclusion: "done",
      rootCause: "phish click",
    }).ok,
    true,
  );
  assert.equal(
    evalReqs([{ type: "root_cause_and_conclusion" }], baseCtx(), baseInput).ok,
    false,
  );
  console.log("ok: root_cause_and_conclusion");
}

{
  assert.equal(
    evalReqs([{ type: "business_impact_and_lessons" }], baseCtx(), {
      ...baseInput,
      businessImpact: "none",
      lessonsLearned: "train staff",
    }).ok,
    true,
  );
  assert.equal(
    evalReqs([{ type: "business_impact_and_lessons" }], baseCtx(), baseInput).ok,
    false,
  );
  console.log("ok: business_impact_and_lessons");
}

{
  assert.equal(
    evalReqs([{ type: "required_approver" }], baseCtx(), {
      ...baseInput,
      approverId: "user_other",
    }).ok,
    true,
  );
  assert.equal(evalReqs([{ type: "required_approver" }], baseCtx(), baseInput).ok, false);
  console.log("ok: required_approver");
}

{
  assert.equal(
    evalReqs([{ type: "response_actions_resolved" }], baseCtx()).ok,
    true,
  );
  assert.equal(
    evalReqs([{ type: "response_actions_resolved" }], baseCtx({
      openResponseActions: [{ id: "r1", status: "awaiting_approval", target: "host1" }],
    })).ok,
    false,
  );
  console.log("ok: response_actions_resolved");
}

{
  assert.equal(
    evalReqs([{ type: "related_high_severity_reviewed" }], baseCtx({
      relatedHighSeverity: [
        { id: "c2", caseNumber: "KP-2", severity: "high", status: "open" },
      ],
    }), {
      ...baseInput,
      reviewedRelatedCaseIds: ["c2"],
    }).ok,
    true,
  );
  assert.equal(
    evalReqs([{ type: "related_high_severity_reviewed" }], baseCtx({
      relatedHighSeverity: [
        { id: "c2", caseNumber: "KP-2", severity: "critical", status: "open" },
      ],
    }), baseInput).ok,
    false,
  );
  // Closed related cases do not need explicit review.
  assert.equal(
    evalReqs([{ type: "related_high_severity_reviewed" }], baseCtx({
      relatedHighSeverity: [
        { id: "c2", caseNumber: "KP-2", severity: "high", status: "closed" },
      ],
    }), baseInput).ok,
    true,
  );
  console.log("ok: related_high_severity_reviewed");
}

{
  assert.equal(
    evalReqs(
      [{ type: "post_incident_review", severities: ["high", "critical"] }],
      baseCtx({ case: { ...baseCtx().case, severity: "high" } }),
      { ...baseInput, postIncidentReviewCompleted: true },
    ).ok,
    true,
  );
  assert.equal(
    evalReqs(
      [{ type: "post_incident_review", severities: ["high", "critical"] }],
      baseCtx({ case: { ...baseCtx().case, severity: "high" } }),
      baseInput,
    ).ok,
    false,
  );
  // Low severity does not require PIR under default high/critical gate.
  assert.equal(
    evalReqs(
      [{ type: "post_incident_review", severities: ["high", "critical"] }],
      baseCtx({ case: { ...baseCtx().case, severity: "low" } }),
      baseInput,
    ).ok,
    true,
  );
  console.log("ok: post_incident_review");
}

// ── DB-backed integration ───────────────────────────────────────────────

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "Closure A", slug: `i57-a-${runId}` },
    { id: orgBId, name: "Closure B", slug: `i57-b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: adminAId,
      name: "Admin A",
      email: `i57-admin-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: analystAId,
      name: "Analyst A",
      email: `i57-analyst-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: adminBId,
      name: "Admin B",
      email: `i57-badmin-${runId}@example.com`,
      organisationId: orgBId,
      role: "admin",
    },
  ]);
}

async function cleanup() {
  await db.delete(organisations).where(eq(organisations.id, orgAId));
  await db.delete(organisations).where(eq(organisations.id, orgBId));
  console.log("ok: fixture cleanup");
}

async function seedCase(orgId: string, title: string): Promise<string> {
  const id = newId("case");
  await db.insert(cases).values({
    id,
    organisationId: orgId,
    caseNumber: `I57-${runId}-${id.slice(-6)}`,
    title,
    status: "in_progress",
    severity: "medium",
  });
  return id;
}

async function main() {
  await setup();
  try {
    // Built-in disposition-only close
    const caseSimple = await seedCase(orgAId, "Simple close");
    const closed = await closeCaseCore(orgAId, analystAId, caseSimple, {
      disposition: "resolved",
      conclusion: "All good",
    });
    assert.ok(closed.snapshotId);
    assert.equal(closed.wasOverride, false);
    const [row] = await db.select().from(cases).where(eq(cases.id, caseSimple));
    assert.equal(row?.status, "closed");
    assert.equal(row?.closureReason, "resolved");
    console.log("ok: close with built-in disposition policy");

    // setCaseStatusCore refuses closed / reopen shortcuts
    const caseStatus = await seedCase(orgAId, "Status gate");
    await assert.rejects(
      () => setCaseStatusCore(orgAId, analystAId, caseStatus, "closed"),
      (e: unknown) => e instanceof ClosurePathError,
    );
    await closeCaseCore(orgAId, analystAId, caseStatus, {
      disposition: "benign",
      conclusion: "noise",
    });
    await assert.rejects(
      () => setCaseStatusCore(orgAId, analystAId, caseStatus, "open"),
      (e: unknown) => e instanceof ClosurePathError,
    );
    console.log("ok: status path gates close/reopen");

    // Policy versioning
    const { id: policyId, versionId: v1 } = await createClosurePolicyCore(
      orgAId,
      adminAId,
      {
        name: "Strict IR",
        isDefault: true,
        requirements: [
          { type: "disposition" },
          { type: "required_tasks_complete" },
        ],
      },
    );
    const [p1] = await db
      .select()
      .from(caseClosurePolicies)
      .where(eq(caseClosurePolicies.id, policyId));
    assert.equal(p1?.currentVersion, 1);

    const caseTasksReq = await seedCase(orgAId, "Needs tasks");
    await db.insert(caseTasks).values({
      id: newId("task"),
      caseId: caseTasksReq,
      title: "Required step",
      isRequired: true,
      status: "todo",
    });
    await assert.rejects(
      () =>
        closeCaseCore(orgAId, analystAId, caseTasksReq, {
          disposition: "resolved",
          conclusion: "done",
        }),
      (e: unknown) =>
        e instanceof ClosureRequirementsError &&
        e.evaluation.failed.some((f) => f.type === "required_tasks_complete"),
    );
    console.log("ok: policy blocks close when required tasks open");

    // Override denied without permission
    await assert.rejects(
      () =>
        closeCaseCore(orgAId, analystAId, caseTasksReq, {
          disposition: "resolved",
          conclusion: "done",
          override: true,
          overrideReason: "we are sure",
          canOverride: false,
        }),
      (e: unknown) => e instanceof ClosureOverrideError && e.status === 403,
    );
    console.log("ok: override requires permission");

    // Override succeeds for admin flag
    const overridden = await closeCaseCore(orgAId, adminAId, caseTasksReq, {
      disposition: "risk_accepted",
      conclusion: "Accepted residual risk",
      override: true,
      overrideReason: "Business accepted residual risk after review",
      canOverride: true,
    });
    assert.equal(overridden.wasOverride, true);
    const snaps = await listClosureSnapshotsCore(orgAId, caseTasksReq);
    assert.equal(snaps.length, 1);
    assert.equal(snaps[0]?.wasOverride, true);
    assert.ok(snaps[0]?.overrideReason?.includes("Business accepted"));
    assert.ok(Array.isArray(snaps[0]?.overrideFailedSnapshot));
    console.log("ok: privileged override records reason and failed snapshot");

    // Version bump does not rewrite v1
    const { version: v2 } = await updateClosurePolicyCore(orgAId, adminAId, policyId, {
      name: "Strict IR",
      isDefault: true,
      requirements: [
        { type: "disposition" },
        { type: "required_tasks_complete" },
        { type: "evidence_verdicts" },
      ],
    });
    assert.equal(v2, 2);
    const versions = await db
      .select()
      .from(caseClosurePolicyVersions)
      .where(eq(caseClosurePolicyVersions.policyId, policyId));
    assert.equal(versions.length, 2);
    const v1Row = versions.find((v) => v.version === 1);
    const v1Reqs = v1Row?.requirements as ClosureRequirementConfig[];
    assert.equal(v1Reqs.length, 2, "historical version requirements stay frozen");
    assert.ok(!v1Reqs.some((r) => r.type === "evidence_verdicts"));
    // Prior close still points at policy version 1 snapshot
    assert.equal(snaps[0]?.policyVersion, 1);
    console.log("ok: policy versioning keeps historical requirements immutable");

    // Reopen retains snapshots + requires reason
    await assert.rejects(
      () =>
        reopenCaseCore(orgAId, analystAId, caseTasksReq, { reason: "no" }),
      (e: unknown) => e instanceof ClosurePathError,
    );
    const reopened = await reopenCaseCore(orgAId, analystAId, caseTasksReq, {
      reason: "New IOC matched in TI feed",
    });
    assert.ok(reopened.snapshotId);
    const [reopenedCase] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, caseTasksReq));
    assert.equal(reopenedCase?.status, "in_progress");
    assert.ok(reopenedCase?.lastReopenedAt);
    const snapsAfter = await listClosureSnapshotsCore(orgAId, caseTasksReq);
    assert.equal(snapsAfter.length, 1, "prior snapshot retained");
    assert.ok(snapsAfter[0]?.reopenedAt);
    assert.equal(snapsAfter[0]?.reopenReason, "New IOC matched in TI feed");
    console.log("ok: reopen retains snapshots and requires reason");

    // Close again creates second snapshot
    await db
      .update(caseTasks)
      .set({ status: "done", completedAt: new Date(), completedBy: analystAId })
      .where(eq(caseTasks.caseId, caseTasksReq));
    // v2 also needs evidence verdicts — no evidence items means pass
    await closeCaseCore(orgAId, analystAId, caseTasksReq, {
      disposition: "resolved",
      conclusion: "Second close after TI follow-up",
    });
    const snaps2 = await listClosureSnapshotsCore(orgAId, caseTasksReq);
    assert.equal(snaps2.length, 2);
    assert.equal(snaps2.filter((s) => !s.reopenedAt).length, 1);
    console.log("ok: second close creates another snapshot");

    // Concurrency: stale version rejected
    const caseVer = await seedCase(orgAId, "Version race");
    const [verRow] = await db.select().from(cases).where(eq(cases.id, caseVer));
    await closeCaseCore(orgAId, analystAId, caseVer, {
      disposition: "resolved",
      conclusion: "first",
      expectedVersion: verRow!.version,
    });
    await assert.rejects(
      () =>
        reopenCaseCore(orgAId, analystAId, caseVer, {
          reason: "stale attempt",
          expectedVersion: verRow!.version, // stale
        }),
      (e: unknown) => e instanceof CaseVersionConflictError,
    );
    console.log("ok: closure/reopen concurrency uses case version checks");

    // Tenant isolation: org B cannot close org A case
    const caseA = await seedCase(orgAId, "Tenant A case");
    await assert.rejects(
      () =>
        closeCaseCore(orgBId, adminBId, caseA, {
          disposition: "resolved",
          conclusion: "cross tenant",
        }),
      (e: unknown) => e instanceof ClosurePathError,
    );
    const snapsB = await listClosureSnapshotsCore(orgBId, caseA);
    assert.equal(snapsB.length, 0);
    const [stillOpen] = await db.select().from(cases).where(eq(cases.id, caseA));
    assert.equal(stillOpen?.status, "in_progress");
    console.log("ok: tenant isolation on close and snapshot list");

    // Full requirement set against a rich context (DB path)
    const richCase = await seedCase(orgAId, "Rich requirements");
    await db
      .update(cases)
      .set({
        severity: "high",
        containedAt: new Date(),
        eradicatedAt: new Date(),
        resolvedAt: new Date(),
      })
      .where(eq(cases.id, richCase));
    await db.insert(caseTasks).values({
      id: newId("task"),
      caseId: richCase,
      title: "Done task",
      isRequired: true,
      status: "done",
      completedAt: new Date(),
    });
    const fieldId = newId("cfd");
    await db.insert(customFieldDefinitions).values({
      id: fieldId,
      organisationId: orgAId,
      entity: "case",
      key: "business_unit",
      label: "Business unit",
      type: "string",
      required: true,
    });
    await db.insert(customFieldValues).values({
      id: newId("cfv"),
      entity: "case",
      entityId: richCase,
      fieldId,
      value: "Finance",
    });
    const sourceId = newId("asrc");
    await db.insert(alertSources).values({
      id: sourceId,
      organisationId: orgAId,
      kind: "manual",
      name: `i57-${runId}`,
    });
    const alertId = newId("alert");
    await db.insert(alerts).values({
      id: alertId,
      organisationId: orgAId,
      sourceId,
      externalId: `ext-${runId}`,
      title: "Rich alert",
      status: "closed",
      determination: "true_positive",
    });
    await db.insert(caseAlerts).values({
      id: newId("calert"),
      organisationId: orgAId,
      caseId: richCase,
      alertId,
    });
    await db.insert(evidenceItems).values({
      id: newId("evi"),
      organisationId: orgAId,
      caseId: richCase,
      type: "file_hash",
      value: "deadbeef",
      verdict: "malicious",
    });
    await updateClosurePolicyCore(orgAId, adminAId, policyId, {
      name: "Strict IR",
      isDefault: true,
      requirements: [
        { type: "disposition" },
        { type: "required_tasks_complete" },
        { type: "required_custom_fields" },
        { type: "alerts_dispositioned" },
        { type: "evidence_verdicts" },
        { type: "containment_recorded" },
        { type: "eradication_recorded" },
        { type: "recovery_recorded" },
        { type: "root_cause_and_conclusion" },
        { type: "business_impact_and_lessons" },
        { type: "required_approver" },
        { type: "response_actions_resolved" },
        { type: "related_high_severity_reviewed" },
        { type: "post_incident_review", severities: ["high", "critical"] },
      ],
      requireTwoPersonOverride: false,
    });
    const richClose = await closeCaseCore(orgAId, analystAId, richCase, {
      disposition: "resolved",
      conclusion: "Full investigation complete",
      rootCause: "Credential phishing",
      businessImpact: "None material",
      lessonsLearned: "Faster MFA",
      approverId: adminAId,
      postIncidentReviewCompleted: true,
      reviewedRelatedCaseIds: [],
    });
    assert.equal(richClose.wasOverride, false);
    assert.equal(richClose.evaluation.ok, true);
    assert.equal(richClose.evaluation.requirements.length, 14);
    console.log("ok: close succeeds when all requirement types pass");

    // Two-person override gate
    await updateClosurePolicyCore(orgAId, adminAId, policyId, {
      name: "Strict IR",
      isDefault: true,
      requirements: [
        { type: "disposition" },
        { type: "required_tasks_complete" },
      ],
      requireTwoPersonOverride: true,
    });
    const twoPersonCase = await seedCase(orgAId, "Two person");
    await db.insert(caseTasks).values({
      id: newId("task"),
      caseId: twoPersonCase,
      title: "Still open",
      isRequired: true,
      status: "todo",
    });
    await assert.rejects(
      () =>
        closeCaseCore(orgAId, adminAId, twoPersonCase, {
          disposition: "risk_accepted",
          conclusion: "override without second",
          override: true,
          overrideReason: "Need to close urgently for board",
          canOverride: true,
        }),
      (e: unknown) => e instanceof ClosureOverrideError,
    );
    console.log("ok: two-person override requires second approver");

    await assert.rejects(
      () =>
        closeCaseCore(orgAId, adminAId, twoPersonCase, {
          disposition: "risk_accepted",
          conclusion: "override with non-admin",
          override: true,
          overrideReason: "Need to close urgently for board",
          canOverride: true,
          approverId: analystAId,
        }),
      (e: unknown) => e instanceof ClosureOverrideError,
    );
    console.log("ok: two-person override rejects non-admin approver");

    const adminA2 = `user_i57_admin2_${runId}`;
    await db.insert(users).values({
      id: adminA2,
      name: "Admin A2",
      email: `i57-admin2-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    });
    const twoPersonOk = await closeCaseCore(orgAId, adminAId, twoPersonCase, {
      disposition: "risk_accepted",
      conclusion: "override with second admin",
      override: true,
      overrideReason: "Need to close urgently for board",
      canOverride: true,
      approverId: adminA2,
    });
    assert.equal(twoPersonOk.wasOverride, true);
    console.log("ok: two-person override accepts second admin");

    const events = await db
      .select({
        eventType: timelineEvents.eventType,
        payload: timelineEvents.payload,
      })
      .from(timelineEvents)
      .where(eq(timelineEvents.caseId, twoPersonCase));
    assert.ok(
      events.some(
        (e) =>
          e.eventType === "status_change" &&
          (e.payload as { override?: boolean }).override === true,
      ),
      "override close writes status_change with override flag",
    );
    console.log("ok: override is timeline-audited");

    // silence unused
    void v1;
    void caseClosurePolicyVersions;
    void caseClosurePolicies;

    await cleanup();
    console.log("case closure tests passed");
  } catch (err) {
    throw err;
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await cleanup();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
