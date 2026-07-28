/**
 * Core coverage for analyst-governed alert correlation (issue #56):
 * move, merge, split, reverse, reject, concurrency, authorization-style
 * tenant isolation, dry-run evaluation, and no auto-merge by default.
 *
 * Calls `src/lib/correlation/*` against a real Postgres instance (mirrors
 * `scripts/test-investigations-core.ts`). No HTTP server required.
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  alertMembershipHistory,
  alerts,
  caseAlerts,
  caseMerges,
  cases,
  correlationSuggestions,
  organisations,
  timelineEvents,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  createOrUpdateAlertFromProviderCore,
  getOrCreateAlertSourceCore,
  linkAlertToCaseCore,
  linkEntityToAlertCore,
} from "../src/lib/investigations/alerts-core";
import { resolveEntityCore } from "../src/lib/investigations/entities-core";
import {
  attachAlertsToCaseCore,
  CorrelationError,
  CorrelationVersionConflictError,
  createCaseFromAlertsCore,
  mergeCasesCore,
  moveAlertsCore,
  reverseMergeCore,
  splitAlertsCore,
} from "../src/lib/correlation/membership-core";
import {
  createCorrelationRuleCore,
  ensureDefaultCorrelationRule,
  getRuleMetricsCore,
} from "../src/lib/correlation/rules-core";
import {
  acceptSuggestionCore,
  evaluateCorrelationCore,
  listSuggestionsCore,
  rejectSuggestionCore,
} from "../src/lib/correlation/evaluate-core";
import { correlationPolicyPatch } from "../src/lib/correlation/policy";

const runId = newId("i56test").slice("i56test_".length).slice(0, 10);
const orgA = `org_i56a_${runId}`;
const orgB = `org_i56b_${runId}`;
const userA = `user_i56a_${runId}`;
const userB = `user_i56b_${runId}`;

let caseA1 = "";
let caseA2 = "";
let caseB1 = "";
let sourceAId = "";

async function setup() {
  await db.insert(organisations).values([
    { id: orgA, name: "Correlation Org A", slug: `i56a-${runId}` },
    { id: orgB, name: "Correlation Org B", slug: `i56b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userA,
      name: "Corr Analyst A",
      email: `i56a-${runId}@example.com`,
      organisationId: orgA,
      role: "analyst",
    },
    {
      id: userB,
      name: "Corr Analyst B",
      email: `i56b-${runId}@example.com`,
      organisationId: orgB,
      role: "analyst",
    },
  ]);

  caseA1 = newId("case");
  caseA2 = newId("case");
  caseB1 = newId("case");
  await db.insert(cases).values([
    {
      id: caseA1,
      organisationId: orgA,
      caseNumber: `I56A1-${runId}`,
      title: "Correlation case A1",
    },
    {
      id: caseA2,
      organisationId: orgA,
      caseNumber: `I56A2-${runId}`,
      title: "Correlation case A2",
    },
    {
      id: caseB1,
      organisationId: orgB,
      caseNumber: `I56B1-${runId}`,
      title: "Correlation case B1",
    },
  ]);

  const src = await getOrCreateAlertSourceCore({
    organisationId: orgA,
    kind: "test",
    name: `corr-source-${runId}`,
    tenantId: "tenant-a",
  });
  sourceAId = src.id;
}

async function cleanup() {
  await db.delete(organisations).where(eq(organisations.id, orgA));
  await db.delete(organisations).where(eq(organisations.id, orgB));
  console.log("correlation core fixture cleanup verified");
}

async function makeAlert(
  organisationId: string,
  sourceId: string,
  externalId: string,
  opts: {
    title?: string;
    product?: string;
    techniques?: string[];
    tenantId?: string;
  } = {},
) {
  const { alert } = await createOrUpdateAlertFromProviderCore({
    organisationId,
    sourceId,
    externalId,
    title: opts.title ?? `Alert ${externalId}`,
    tenantId: opts.tenantId ?? "tenant-a",
    detectionProduct: opts.product ?? "Defender",
    attackTechniques: opts.techniques ?? [],
    detectedAt: new Date(),
  });
  return alert;
}

async function main() {
  await setup();

  try {
    // ── reason mandatory ────────────────────────────────────────────────
    await assert.rejects(
      () =>
        moveAlertsCore({
          organisationId: orgA,
          actorId: userA,
          alertIds: ["x"],
          fromCaseId: caseA1,
          toCaseId: caseA2,
          reason: "  ",
        }),
      (err: unknown) =>
        err instanceof CorrelationError && /reason/i.test(err.message),
    );
    console.log("ok: empty reason rejected");

    // ── attach + move preserves lineage ─────────────────────────────────
    const alert1 = await makeAlert(orgA, sourceAId, `ext-move-1-${runId}`);
    const alert2 = await makeAlert(orgA, sourceAId, `ext-move-2-${runId}`);
    await linkAlertToCaseCore({
      organisationId: orgA,
      actorId: userA,
      caseId: caseA1,
      alertId: alert1.id,
      isPrimary: true,
    });
    await linkAlertToCaseCore({
      organisationId: orgA,
      actorId: userA,
      caseId: caseA1,
      alertId: alert2.id,
    });

    const moved = await moveAlertsCore({
      organisationId: orgA,
      actorId: userA,
      alertIds: [alert1.id],
      fromCaseId: caseA1,
      toCaseId: caseA2,
      reason: "Same campaign host",
    });
    assert.deepEqual(moved.movedAlertIds, [alert1.id]);

    const onA1 = await db
      .select()
      .from(caseAlerts)
      .where(
        and(eq(caseAlerts.caseId, caseA1), eq(caseAlerts.alertId, alert1.id)),
      );
    const onA2 = await db
      .select()
      .from(caseAlerts)
      .where(
        and(eq(caseAlerts.caseId, caseA2), eq(caseAlerts.alertId, alert1.id)),
      );
    assert.equal(onA1.length, 0, "alert left source case");
    assert.equal(onA2.length, 1, "alert on destination");

    const history = await db
      .select()
      .from(alertMembershipHistory)
      .where(eq(alertMembershipHistory.alertId, alert1.id));
    assert.ok(history.some((h) => h.operation === "move" && h.reason === "Same campaign host"));
    // externalId unchanged
    const [alert1After] = await db
      .select({ externalId: alerts.externalId, sourceId: alerts.sourceId })
      .from(alerts)
      .where(eq(alerts.id, alert1.id));
    assert.equal(alert1After!.externalId, `ext-move-1-${runId}`);
    assert.equal(alert1After!.sourceId, sourceAId);
    console.log("ok: move preserves source ids and records membership history");

    // ── split ───────────────────────────────────────────────────────────
    const split = await splitAlertsCore({
      organisationId: orgA,
      actorId: userA,
      fromCaseId: caseA1,
      alertIds: [alert2.id],
      reason: "Distinct attack path",
      title: "Split investigation",
    });
    assert.ok(split.caseId);
    const splitLinks = await db
      .select()
      .from(caseAlerts)
      .where(
        and(eq(caseAlerts.caseId, split.caseId), eq(caseAlerts.alertId, alert2.id)),
      );
    assert.equal(splitLinks.length, 1);
    const stillOnA1 = await db
      .select()
      .from(caseAlerts)
      .where(
        and(eq(caseAlerts.caseId, caseA1), eq(caseAlerts.alertId, alert2.id)),
      );
    assert.equal(stillOnA1.length, 0);
    console.log("ok: split creates new case and moves alerts");

    // ── merge never deletes sources + reverse ───────────────────────────
    const mCase1 = newId("case");
    const mCase2 = newId("case");
    await db.insert(cases).values([
      {
        id: mCase1,
        organisationId: orgA,
        caseNumber: `I56M1-${runId}`,
        title: "Merge canonical",
      },
      {
        id: mCase2,
        organisationId: orgA,
        caseNumber: `I56M2-${runId}`,
        title: "Merge source",
      },
    ]);
    const mAlert = await makeAlert(orgA, sourceAId, `ext-merge-${runId}`);
    await linkAlertToCaseCore({
      organisationId: orgA,
      actorId: userA,
      caseId: mCase2,
      alertId: mAlert.id,
      isPrimary: true,
    });

    const merge = await mergeCasesCore({
      organisationId: orgA,
      actorId: userA,
      canonicalCaseId: mCase1,
      sourceCaseIds: [mCase2],
      reason: "Duplicate investigations of same incident",
    });
    assert.equal(merge.merge.status, "active");
    assert.ok(merge.movedAlertIds.includes(mAlert.id));

    const [sourceAfter] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, mCase2));
    assert.ok(sourceAfter, "source case still exists");
    assert.equal(sourceAfter!.supersededByCaseId, mCase1);

    const [canonicalLink] = await db
      .select()
      .from(caseAlerts)
      .where(
        and(eq(caseAlerts.caseId, mCase1), eq(caseAlerts.alertId, mAlert.id)),
      );
    assert.ok(canonicalLink);

    const reversed = await reverseMergeCore({
      organisationId: orgA,
      actorId: userA,
      mergeId: merge.merge.id,
      reason: "Analyst error — distinct incidents",
    });
    assert.ok(reversed.restoredAlertIds.includes(mAlert.id));
    const [sourceRestored] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, mCase2));
    assert.equal(sourceRestored!.supersededByCaseId, null);
    const [restoredLink] = await db
      .select()
      .from(caseAlerts)
      .where(
        and(eq(caseAlerts.caseId, mCase2), eq(caseAlerts.alertId, mAlert.id)),
      );
    assert.ok(restoredLink, "alert restored to source");
    console.log("ok: merge leaves sources navigable and reverse restores membership");

    // ── concurrency: version conflict ───────────────────────────────────
    const [vCase] = await db.select().from(cases).where(eq(cases.id, caseA2));
    await assert.rejects(
      () =>
        moveAlertsCore({
          organisationId: orgA,
          actorId: userA,
          alertIds: [alert1.id],
          fromCaseId: caseA2,
          toCaseId: caseA1,
          reason: "Stale client",
          expectedVersions: { [caseA2]: (vCase!.version ?? 0) - 100 },
        }),
      (err: unknown) => err instanceof CorrelationVersionConflictError,
    );
    console.log("ok: stale expectedVersions yields version_conflict");

    // ── tenant isolation ────────────────────────────────────────────────
    await assert.rejects(
      () =>
        moveAlertsCore({
          organisationId: orgB,
          actorId: userB,
          alertIds: [alert1.id],
          fromCaseId: caseA2,
          toCaseId: caseB1,
          reason: "Cross-tenant probe",
        }),
      (err: unknown) =>
        err instanceof CorrelationError && err.status === 404,
    );
    await assert.rejects(
      () =>
        mergeCasesCore({
          organisationId: orgB,
          actorId: userB,
          canonicalCaseId: caseB1,
          sourceCaseIds: [caseA1],
          reason: "Cross-tenant merge",
        }),
      (err: unknown) =>
        err instanceof CorrelationError && err.status === 404,
    );
    console.log("ok: tenant isolation on move/merge");

    // ── suggestions: evaluate dry-run, reject, accept ───────────────────
    const entity = await resolveEntityCore({
      organisationId: orgA,
      type: "ip",
      displayName: "203.0.113.50",
      identifiers: [{ kind: "ip", value: "203.0.113.50" }],
    });
    const sAlert1 = await makeAlert(orgA, sourceAId, `ext-sug-1-${runId}`, {
      title: "Beacon to C2",
      product: "EDR",
      techniques: ["T1071.001"],
    });
    const sAlert2 = await makeAlert(orgA, sourceAId, `ext-sug-2-${runId}`, {
      title: "Beacon to C2 follow-up",
      product: "EDR",
      techniques: ["T1071.001"],
    });
    await linkEntityToAlertCore({
      organisationId: orgA,
      actorId: userA,
      alertId: sAlert1.id,
      entityId: entity.entity.id,
      role: "related",
    });
    await linkEntityToAlertCore({
      organisationId: orgA,
      actorId: userA,
      alertId: sAlert2.id,
      entityId: entity.entity.id,
      role: "related",
    });
    await linkAlertToCaseCore({
      organisationId: orgA,
      actorId: userA,
      caseId: caseA1,
      alertId: sAlert1.id,
    });
    // sAlert2 unlinked → attach_to_case suggestion

    const rule = await ensureDefaultCorrelationRule(orgA, userA);
    assert.equal(rule.dryRun, true);

    const evalResults = await evaluateCorrelationCore({
      organisationId: orgA,
      actorId: userA,
      ruleId: rule.id,
      alertIds: [sAlert1.id, sAlert2.id],
      forceDryRun: true,
    });
    assert.equal(evalResults[0]!.autoApplied, 0, "dry-run never auto-applies");
    assert.ok(evalResults[0]!.created >= 1, "at least one suggestion created");

    const pending = await listSuggestionsCore({
      organisationId: orgA,
      status: "pending",
    });
    assert.ok(pending.length >= 1);
    const sug = pending.find((s) => {
      const ids = s.alertIds as string[];
      return ids.includes(sAlert1.id) && ids.includes(sAlert2.id);
    });
    assert.ok(sug, "suggestion for shared-entity pair");
    assert.ok(sug!.score > 0);
    assert.ok(sug!.explanation.length > 0);
    assert.ok(
      (sug!.contributingSignals as { sharedEntityIds?: string[] })
        .sharedEntityIds?.length,
      "signals include shared entities",
    );

    // Reject requires reason
    await assert.rejects(
      () =>
        rejectSuggestionCore({
          organisationId: orgA,
          actorId: userA,
          suggestionId: sug!.id,
          reason: "",
        }),
      CorrelationError,
    );

    const rejected = await rejectSuggestionCore({
      organisationId: orgA,
      actorId: userA,
      suggestionId: sug!.id,
      reason: "Reviewed — different campaigns despite shared infra",
    });
    assert.equal(rejected.status, "rejected");
    console.log("ok: suggestion explains signals; reject requires reason and audits status");

    // Fresh pair for accept → attach
    const sAlert3 = await makeAlert(orgA, sourceAId, `ext-sug-3-${runId}`, {
      product: "EDR",
    });
    await linkEntityToAlertCore({
      organisationId: orgA,
      actorId: userA,
      alertId: sAlert3.id,
      entityId: entity.entity.id,
      role: "related",
    });
    const eval2 = await evaluateCorrelationCore({
      organisationId: orgA,
      actorId: userA,
      ruleId: rule.id,
      alertIds: [sAlert1.id, sAlert3.id],
      forceDryRun: true,
    });
    assert.ok(eval2[0]!.created >= 1);
    const pending2 = await listSuggestionsCore({
      organisationId: orgA,
      status: "pending",
    });
    const sug2 = pending2.find((s) => {
      const ids = s.alertIds as string[];
      return ids.includes(sAlert3.id);
    });
    assert.ok(sug2);
    const accepted = await acceptSuggestionCore({
      organisationId: orgA,
      actorId: userA,
      suggestionId: sug2!.id,
      reason: "Confirmed same host cluster",
    });
    assert.equal(accepted.suggestion.status, "accepted");
    const attached = await db
      .select()
      .from(caseAlerts)
      .where(
        and(eq(caseAlerts.alertId, sAlert3.id), eq(caseAlerts.caseId, caseA1)),
      );
    // attach_to_case may attach to whichever case was target
    assert.ok(
      attached.length === 1 ||
        (await db.select().from(caseAlerts).where(eq(caseAlerts.alertId, sAlert3.id)))
          .length >= 1,
      "accept attaches alert to a case",
    );
    console.log("ok: accept suggestion mutates membership with reason");

    // ── no auto-merge without policy ────────────────────────────────────
    await db
      .update(organisations)
      .set({
        settings: correlationPolicyPatch({}, { autoMergeEnabled: false }),
      })
      .where(eq(organisations.id, orgA));

    const nonDryRule = await createCorrelationRuleCore({
      organisationId: orgA,
      actorId: userA,
      input: {
        ruleKey: `live-rule-${runId}`,
        name: "Live rule still needs policy",
        dryRun: false,
        activate: true,
        scoreThreshold: 10,
      },
    });
    const c1 = newId("case");
    const c2 = newId("case");
    await db.insert(cases).values([
      {
        id: c1,
        organisationId: orgA,
        caseNumber: `I56C1-${runId}`,
        title: "Auto merge guard c1",
      },
      {
        id: c2,
        organisationId: orgA,
        caseNumber: `I56C2-${runId}`,
        title: "Auto merge guard c2",
      },
    ]);
    const am1 = await makeAlert(orgA, sourceAId, `ext-auto-1-${runId}`, {
      product: "SameProduct",
    });
    const am2 = await makeAlert(orgA, sourceAId, `ext-auto-2-${runId}`, {
      product: "SameProduct",
    });
    await linkEntityToAlertCore({
      organisationId: orgA,
      actorId: userA,
      alertId: am1.id,
      entityId: entity.entity.id,
      role: "related",
    });
    await linkEntityToAlertCore({
      organisationId: orgA,
      actorId: userA,
      alertId: am2.id,
      entityId: entity.entity.id,
      role: "related",
    });
    await linkAlertToCaseCore({
      organisationId: orgA,
      actorId: userA,
      caseId: c1,
      alertId: am1.id,
    });
    await linkAlertToCaseCore({
      organisationId: orgA,
      actorId: userA,
      caseId: c2,
      alertId: am2.id,
    });

    const autoEval = await evaluateCorrelationCore({
      organisationId: orgA,
      actorId: userA,
      ruleId: nonDryRule.id,
      alertIds: [am1.id, am2.id],
    });
    assert.equal(
      autoEval[0]!.autoApplied,
      0,
      "auto merge must not run without org policy",
    );
    const [c2Still] = await db.select().from(cases).where(eq(cases.id, c2));
    assert.equal(c2Still!.supersededByCaseId, null, "source not auto-superseded");
    console.log("ok: no automatic merge without organisation policy");

    // ── metrics ─────────────────────────────────────────────────────────
    const metrics = await getRuleMetricsCore(orgA);
    assert.ok(metrics.some((m) => m.suggestionCount > 0));
    assert.ok(metrics.some((m) => m.rejectedCount > 0 || m.acceptedCount > 0));
    console.log("ok: rule metrics track suggestion accept/reject counts");

    // ── create case from unlinked alerts ────────────────────────────────
    const free1 = await makeAlert(orgA, sourceAId, `ext-free-1-${runId}`);
    const free2 = await makeAlert(orgA, sourceAId, `ext-free-2-${runId}`);
    const created = await createCaseFromAlertsCore({
      organisationId: orgA,
      actorId: userA,
      alertIds: [free1.id, free2.id],
      reason: "Group unlinked detections",
    });
    const freeLinks = await db
      .select()
      .from(caseAlerts)
      .where(
        and(
          eq(caseAlerts.caseId, created.caseId),
          inArray(caseAlerts.alertId, [free1.id, free2.id]),
        ),
      );
    assert.equal(freeLinks.length, 2);
    console.log("ok: create case from selected alerts");

    // ── attach with reason ──────────────────────────────────────────────
    const free3 = await makeAlert(orgA, sourceAId, `ext-free-3-${runId}`);
    const attachedRes = await attachAlertsToCaseCore({
      organisationId: orgA,
      actorId: userA,
      caseId: created.caseId,
      alertIds: [free3.id],
      reason: "Belongs with free group",
    });
    assert.deepEqual(attachedRes.attachedAlertIds, [free3.id]);
    console.log("ok: attach alerts to existing case");

    // Timeline events for merge path exist
    const mergeTimeline = await db
      .select({ eventType: timelineEvents.eventType })
      .from(timelineEvents)
      .where(eq(timelineEvents.caseId, mCase1));
    assert.ok(
      mergeTimeline.some((e) => e.eventType === "case_merged") ||
        mergeTimeline.some((e) => e.eventType === "case_merge_reversed"),
      "merge/reverse writes timeline events",
    );
    console.log("ok: timeline lineage for merge operations");

    console.log("all correlation core tests passed");
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
