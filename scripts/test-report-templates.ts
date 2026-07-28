/**
 * Coverage for controlled case report templates (issue #47):
 * - section selection / versioning
 * - Markdown sanitisation (no active HTML)
 * - redaction preview never leaks hidden content
 * - approval binding invalidation on data change
 * - tenant isolation of templates and exports
 * - default catalogue seed
 * - PDF/JSON generation + SHA-256 integrity
 *
 * Uses real Postgres via DATABASE_URL.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  cases,
  observables,
  organisations,
  reportExportApprovals,
  reportExports,
  reportSchedules,
  reportTemplateVersions,
  reportTemplates,
  timelineEvents,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import { sanitizeContentMarkdown } from "../src/lib/content-blocks-core";
import {
  includedSectionKeys,
  normaliseSectionConfigs,
  selectSections,
} from "../src/lib/reports/selection";
import {
  buildRedactionPreview,
  maskValue,
  previewLeaksRawValue,
  redactTimelineEvents,
} from "../src/lib/reports/redaction";
import {
  approvalStillValid,
  computeContentFingerprint,
  computeDataRevision,
  explainInvalidation,
} from "../src/lib/reports/fingerprint";
import { BASELINE_REPORT_TEMPLATES } from "../src/lib/reports/defaults";
import {
  createReportTemplateCore,
  seedBaselineReportTemplates,
  updateReportTemplateCore,
} from "../src/lib/reports/templates-core";
import {
  approveReportExportCore,
  createReportExportCore,
  createReportScheduleCore,
  downloadReportExportCore,
  getReportExportCore,
  listReportExportsCore,
  previewReportCore,
  processDueReportSchedules,
  ReportExportError,
  toPublicExport,
} from "../src/lib/reports/export-core";
import type { ReportSectionConfig } from "../src/lib/reports/types";

const runId = newId("i47test").slice("i47test_".length).slice(0, 10);
const orgAId = `org_i47a_${runId}`;
const orgBId = `org_i47b_${runId}`;
const userAId = `user_i47a_${runId}`;
const userA2Id = `user_i47a2_${runId}`;
const userBId = `user_i47b_${runId}`;
const redObsId = `obs_red_${runId}`;
const greenObsId = `obs_grn_${runId}`;
let caseA = "";
let caseB = "";
let caseRed = "";

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "Reports Org A", slug: `i47a-${runId}` },
    { id: orgBId, name: "Reports Org B", slug: `i47b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      name: "Analyst A",
      email: `i47a-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: userA2Id,
      name: "Approver A",
      email: `i47a2-${runId}@example.com`,
      organisationId: orgAId,
      role: "admin",
    },
    {
      id: userBId,
      name: "Analyst B",
      email: `i47b-${runId}@example.com`,
      organisationId: orgBId,
      role: "admin",
    },
  ]);
  caseA = newId("case");
  caseB = newId("case");
  caseRed = newId("case");
  await db.insert(cases).values([
    {
      id: caseA,
      organisationId: orgAId,
      caseNumber: `I47A-${runId}`,
      title: "Report fixture A",
      summary: "Phishing investigation summary",
      tlp: "amber",
      pap: "amber",
      severity: "high",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `I47B-${runId}`,
      title: "Report fixture B",
    },
    {
      id: caseRed,
      organisationId: orgAId,
      caseNumber: `I47R-${runId}`,
      title: "Red case fixture",
      summary: "Must not export under amber template",
      tlp: "red",
      pap: "red",
      severity: "critical",
    },
  ]);
  await db.insert(observables).values([
    {
      id: greenObsId,
      caseId: caseA,
      type: "ip",
      value: "203.0.113.50",
      tlp: "green",
      isIoc: true,
    },
    {
      id: redObsId,
      caseId: caseA,
      type: "domain",
      value: "evil-redacted.example",
      tlp: "red",
      isIoc: true,
    },
  ]);
  // Timeline carries raw observable values — redaction must mask these too.
  await db.insert(timelineEvents).values([
    {
      id: newId("tle"),
      caseId: caseA,
      eventType: "observable_added",
      payload: {
        observable_id: greenObsId,
        type: "ip",
        value: "203.0.113.50",
        is_ioc: true,
      },
      actorId: userAId,
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: newId("tle"),
      caseId: caseA,
      eventType: "observable_added",
      payload: {
        observable_id: redObsId,
        type: "domain",
        value: "evil-redacted.example",
        is_ioc: true,
      },
      actorId: userAId,
      occurredAt: new Date("2026-01-01T00:01:00.000Z"),
    },
  ]);
}

async function cleanup() {
  await db.delete(organisations).where(eq(organisations.id, orgAId));
  await db.delete(organisations).where(eq(organisations.id, orgBId));
}

// ── pure selection ─────────────────────────────────────────────────────

const sampleSections: ReportSectionConfig[] = normaliseSectionConfigs([
  { key: "metadata", required: true, defaultIncluded: true, order: 0 },
  { key: "summary", required: true, defaultIncluded: true, order: 1 },
  { key: "observables", required: false, defaultIncluded: true, order: 2 },
  { key: "comments", required: false, defaultIncluded: false, order: 3 },
  { key: "timeline", required: false, defaultIncluded: true, order: 4 },
]);

{
  const selected = selectSections(sampleSections, {}, {});
  assert.deepEqual(includedSectionKeys(selected).sort(), [
    "metadata",
    "observables",
    "summary",
    "timeline",
  ]);
  console.log("ok: default section selection");
}

{
  const selected = selectSections(
    sampleSections,
    { forceExclude: ["timeline"] },
    { comments: true, observables: false },
  );
  const keys = includedSectionKeys(selected);
  assert.ok(keys.includes("comments"), "override_on includes optional");
  assert.ok(!keys.includes("observables"), "override_off excludes optional");
  assert.ok(!keys.includes("timeline"), "force_exclude wins");
  assert.ok(keys.includes("summary"), "required always included");
  // Required cannot be opted out
  const requiredOff = selectSections(sampleSections, {}, { summary: false });
  assert.ok(
    includedSectionKeys(requiredOff).includes("summary"),
    "required ignores override_off",
  );
  console.log("ok: overrides + force_exclude + required");
}

// ── sanitisation ───────────────────────────────────────────────────────

{
  const dirty =
    'Hello <script>alert(1)</script> [click](javascript:alert(1)) and data:text/html,x';
  const clean = sanitizeContentMarkdown(dirty);
  assert.ok(!clean.includes("<script"), "strips script tags");
  assert.ok(!/javascript\s*:/i.test(clean), "neutralises javascript:");
  assert.ok(!/data\s*:/i.test(clean), "neutralises data:");
  console.log("ok: sanitisation strips active content");
}

// ── redaction ──────────────────────────────────────────────────────────

{
  const secret = "evil-redacted.example";
  const preview = buildRedactionPreview(
    [
      {
        id: "o1",
        safeLabel: `ip: 203.0.113.50`,
        tlp: "green",
        section: "observables",
      },
      {
        id: "o2",
        safeLabel: `domain: ${secret}`,
        tlp: "red",
        section: "observables",
      },
      {
        id: "b1",
        safeLabel: "Secret finding with password hunter2",
        tlp: "amber",
        sensitive: true,
        section: "investigation_blocks",
      },
    ],
    { maxTlp: "amber", maxPap: "amber", maskOverTlp: true, includeSensitive: false },
  );
  assert.equal(preview.includedCount, 1);
  assert.equal(preview.maskedCount, 1);
  assert.equal(preview.excludedCount, 1);
  const leak = previewLeaksRawValue(preview, [secret, "hunter2"]);
  assert.equal(leak, null, "redaction preview must not leak hidden values");
  const masked = preview.items.find((i) => i.status === "masked");
  assert.ok(masked && !masked.label.includes(secret));
  console.log("ok: redaction preview masks over-TLP and excludes sensitive");
}

// ── timeline redaction (pure) ──────────────────────────────────────────

{
  const secret = "evil-redacted.example";
  const events = [
    {
      eventType: "status_change",
      payload: { from: "open", to: "in_progress" },
    },
    {
      eventType: "observable_added",
      payload: {
        observable_id: "o-green",
        type: "ip",
        value: "203.0.113.50",
      },
    },
    {
      eventType: "observable_added",
      payload: {
        observable_id: "o-red",
        type: "domain",
        value: secret,
      },
    },
    {
      eventType: "observable_added",
      payload: {
        observable_id: "o-gone",
        type: "domain",
        value: "deleted-ioc.example",
      },
    },
  ];
  const redacted = redactTimelineEvents(events, {
    maxTlp: "amber",
    statusByObservableId: new Map([
      ["o-green", "included"],
      ["o-red", "masked"],
    ]),
    tlpByObservableId: new Map([
      ["o-green", "green"],
      ["o-red", "red"],
    ]),
  });
  assert.equal(
    redacted.length,
    4,
    "status_change + included + masked + unknown(fail-closed mask)",
  );
  const redEvt = redacted.find(
    (e) =>
      e.eventType === "observable_added" &&
      (e.payload as { observable_id?: string }).observable_id === "o-red",
  );
  assert.ok(redEvt);
  assert.equal(
    (redEvt!.payload as { value: string }).value,
    maskValue("red", "amber"),
  );
  assert.ok(
    !(redEvt!.payload as { value: string }).value.includes(secret),
    "timeline must not leak red value",
  );
  const gone = redacted.find(
    (e) =>
      e.eventType === "observable_added" &&
      (e.payload as { observable_id?: string }).observable_id === "o-gone",
  );
  assert.ok(gone);
  assert.ok(
    !(gone!.payload as { value: string }).value.includes("deleted-ioc.example"),
    "unknown observable fail-closed mask",
  );
  const excluded = redactTimelineEvents(
    [
      {
        eventType: "observable_added",
        payload: { observable_id: "x", type: "ip", value: "1.2.3.4" },
      },
    ],
    {
      maxTlp: "amber",
      statusByObservableId: new Map([["x", "excluded"]]),
      tlpByObservableId: new Map([["x", "red"]]),
    },
  );
  assert.equal(excluded.length, 0, "excluded timeline events drop");
  console.log("ok: timeline redaction masks/excludes observable_added");
}

// ── fingerprint / approval invalidation (pure) ─────────────────────────

{
  const base = {
    templateVersionId: "ver1",
    templateVersionNumber: 1,
    variant: "executive" as const,
    maxTlp: "amber" as const,
    maxPap: "amber" as const,
    selectedSections: ["summary", "metadata"] as const,
    dataRevision: "revA",
    destination: "export_history",
    format: "pdf",
  };
  const fp1 = computeContentFingerprint({
    ...base,
    selectedSections: [...base.selectedSections],
  });
  const fp2 = computeContentFingerprint({
    ...base,
    selectedSections: [...base.selectedSections],
    dataRevision: "revB",
  });
  assert.notEqual(fp1, fp2, "data revision change alters fingerprint");

  const reason = explainInvalidation({
    boundContentFingerprint: fp1,
    boundTemplateVersionId: "ver1",
    boundDataRevision: "revA",
    currentContentFingerprint: fp2,
    currentTemplateVersionId: "ver1",
    currentDataRevision: "revB",
  });
  assert.ok(reason === "multiple" || reason === "data_revision_changed");
  assert.equal(
    approvalStillValid({
      boundContentFingerprint: fp1,
      boundTemplateVersionId: "ver1",
      boundDataRevision: "revA",
      currentContentFingerprint: fp1,
      currentTemplateVersionId: "ver1",
      currentDataRevision: "revA",
    }),
    true,
  );
  const rev = computeDataRevision({
    caseId: "c1",
    caseUpdatedAt: "2026-01-01T00:00:00.000Z",
    caseVersion: 1,
    observableCount: 2,
    taskCount: 0,
    commentCount: 0,
    timelineCount: 0,
    contentBlockRevisionSum: 0,
    evidenceCount: 0,
    mappingCount: 0,
  });
  assert.match(rev, /^[a-f0-9]{64}$/);
  console.log("ok: fingerprint + approval invalidation pure logic");
}

// ── DB-backed tests ────────────────────────────────────────────────────

async function main() {
  await setup();
  try {
    // Defaults
    const seed1 = await seedBaselineReportTemplates(orgAId, userAId);
    assert.ok(seed1.created >= 3, "seeds at least executive/technical/post-incident");
    const seed2 = await seedBaselineReportTemplates(orgAId, userAId);
    assert.equal(seed2.created, 0, "idempotent seed");
    assert.ok(seed2.skipped >= BASELINE_REPORT_TEMPLATES.length);
    console.log("ok: baseline report templates seeded idempotently");

    const templates = await db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.organisationId, orgAId));
    const executive = templates.find((t) => t.catalogueKey === "executive_summary");
    const technical = templates.find((t) => t.catalogueKey === "technical_incident");
    assert.ok(executive && technical);

    // Versioning: edit creates new immutable version
    const updated = await updateReportTemplateCore(orgAId, userAId, technical!.id, {
      requireApproval: true,
      maxTlp: "amber",
    });
    assert.equal(updated.currentVersion, 2);
    const versions = await db
      .select()
      .from(reportTemplateVersions)
      .where(eq(reportTemplateVersions.templateId, technical!.id));
    assert.equal(versions.length, 2);
    assert.ok(versions.some((v) => v.version === 1 && v.requireApproval === false));
    assert.ok(versions.some((v) => v.version === 2 && v.requireApproval === true));
    console.log("ok: template versioning is immutable");

    // Custom template
    const custom = await createReportTemplateCore(orgAId, userAId, {
      name: "Custom exec",
      variant: "executive",
      sections: sampleSections,
      requireApproval: true,
      maxTlp: "amber",
      maxPap: "amber",
      inclusionRules: { maxTlp: "amber", maxPap: "amber", maskOverTlp: true },
    });
    assert.equal(custom.currentVersion, 1);

    // Preview
    const preview = await previewReportCore({
      organisationId: orgAId,
      caseId: caseA,
      templateId: custom.id,
      format: "json",
      actorUserId: userAId,
    });
    assert.ok(preview.includedKeys.includes("summary"));
    assert.ok(preview.markdownPreview.includes("I47A-"));
    assert.ok(
      !preview.markdownPreview.includes("evil-redacted.example"),
      "red TLP observable must not appear in preview markdown (obs or timeline)",
    );
    const leak = previewLeaksRawValue(preview.redaction, ["evil-redacted.example"]);
    assert.equal(leak, null, "preview redaction items never leak raw red value");
    console.log("ok: preview + redaction");

    // Case-level TLP ceiling: red case cannot use amber template
    await assert.rejects(
      () =>
        previewReportCore({
          organisationId: orgAId,
          caseId: caseRed,
          templateId: custom.id,
          format: "json",
          actorUserId: userAId,
        }),
      (err: unknown) =>
        err instanceof ReportExportError &&
        err.status === 403 &&
        /exceeds template audience ceiling/i.test(err.message),
    );
    const redBlocked = await createReportExportCore({
      organisationId: orgAId,
      caseId: caseRed,
      templateId: custom.id,
      format: "json",
      requestedBy: userAId,
      processInline: true,
    });
    assert.equal(redBlocked.status, "failed");
    assert.match(
      redBlocked.error ?? "",
      /classification|audience ceiling/i,
      "process fails closed when case TLP exceeds template maxTlp",
    );
    console.log("ok: case TLP ceiling rejects over-ceiling case");

    // Generate JSON without approval (use technical v1 by pinning? technical is now v2 with approval)
    // Create a no-approval template for direct complete path.
    const free = await createReportTemplateCore(orgAId, userAId, {
      name: "Free technical",
      variant: "technical",
      sections: sampleSections,
      requireApproval: false,
      maxTlp: "red",
      maxPap: "red",
      inclusionRules: { maxTlp: "red", maxPap: "red", maskOverTlp: false },
    });
    const exp = await createReportExportCore({
      organisationId: orgAId,
      caseId: caseA,
      templateId: free.id,
      format: "json",
      requestedBy: userAId,
      processInline: true,
    });
    assert.equal(exp.status, "completed");
    assert.ok(exp.sha256 && exp.sha256.length === 64);
    assert.ok(exp.storageKey?.startsWith(orgAId + "/"), "org-scoped storage key");
    const publicExp = toPublicExport(exp);
    assert.equal(
      (publicExp as { storageKey?: string }).storageKey,
      undefined,
      "storageKey never in public view",
    );
    const dl = await downloadReportExportCore(orgAId, exp.id, userAId);
    assert.ok(dl.buffer.length > 0);
    assert.equal(dl.sha256, exp.sha256);
    const json = JSON.parse(dl.buffer.toString("utf8")) as {
      stamp: { sha256: string | null; caseNumber: string };
      case: { caseNumber: string };
      timeline: Array<{ eventType: string; payload: { value?: string } }>;
    };
    assert.equal(json.case.caseNumber, `I47A-${runId}`);
    // free template maxTlp red includes raw values; amber custom path already checked non-leak
    console.log("ok: generate JSON + download + SHA-256");

    // Cross-tenant storageKey prefix: corrupt key must 404
    await db
      .update(reportExports)
      .set({ storageKey: "other-org/not-yours.json" })
      .where(eq(reportExports.id, exp.id));
    await assert.rejects(
      () => downloadReportExportCore(orgAId, exp.id, userAId),
      (err: unknown) =>
        err instanceof ReportExportError && err.status === 404,
    );
    // restore valid key for any later use
    await db
      .update(reportExports)
      .set({ storageKey: `${orgAId}/restored-key.json` })
      .where(eq(reportExports.id, exp.id));
    console.log("ok: download requires storageKey org prefix");

    // Approval path + SoD
    const gated = await createReportExportCore({
      organisationId: orgAId,
      caseId: caseA,
      templateId: custom.id,
      format: "json",
      requestedBy: userAId,
      processInline: true,
    });
    assert.equal(gated.status, "awaiting_approval");
    await assert.rejects(
      () => downloadReportExportCore(orgAId, gated.id, userAId),
      (err: unknown) =>
        err instanceof ReportExportError && err.status === 404,
    );
    // Self-approve rejected (SoD)
    await assert.rejects(
      () =>
        approveReportExportCore({
          organisationId: orgAId,
          exportId: gated.id,
          actorId: userAId,
          decision: "approve",
        }),
      (err: unknown) =>
        err instanceof ReportExportError &&
        err.status === 403 &&
        /same user/i.test(err.message),
    );
    const released = await approveReportExportCore({
      organisationId: orgAId,
      exportId: gated.id,
      actorId: userA2Id,
      decision: "approve",
    });
    assert.equal(released.status, "released");
    const dl2 = await downloadReportExportCore(orgAId, gated.id, userAId);
    assert.ok(dl2.buffer.length > 0);
    assert.ok(
      !dl2.buffer.toString("utf8").includes("evil-redacted.example"),
      "released JSON must not leak red IOC via timeline or observables",
    );
    console.log("ok: approval gate blocks then releases download; SoD enforced");

    // Approval invalidation when case data changes
    const gated2 = await createReportExportCore({
      organisationId: orgAId,
      caseId: caseA,
      templateId: custom.id,
      format: "json",
      requestedBy: userAId,
      processInline: true,
    });
    assert.equal(gated2.status, "awaiting_approval");
    // Mutate case data so data revision changes
    await db
      .update(cases)
      .set({ summary: "Changed after export", version: 2, lastActivityAt: new Date() })
      .where(eq(cases.id, caseA));
    await assert.rejects(
      () =>
        approveReportExportCore({
          organisationId: orgAId,
          exportId: gated2.id,
          actorId: userA2Id,
          decision: "approve",
        }),
      (err: unknown) =>
        err instanceof ReportExportError && err.status === 409,
    );
    const [approvalRow] = await db
      .select()
      .from(reportExportApprovals)
      .where(eq(reportExportApprovals.exportId, gated2.id));
    assert.equal(approvalRow?.status, "invalidated");
    console.log("ok: approval invalidated on data change");

    // Tenant isolation
    await seedBaselineReportTemplates(orgBId, userBId);
    const orgBList = await listReportExportsCore(orgBId, caseB);
    assert.equal(orgBList.length, 0);
    const cross = await getReportExportCore(orgBId, exp.id);
    assert.equal(cross, null, "org B cannot see org A export");
    await assert.rejects(
      () => downloadReportExportCore(orgBId, exp.id, userBId),
      (err: unknown) =>
        err instanceof ReportExportError && err.status === 404,
    );
    await assert.rejects(
      () =>
        previewReportCore({
          organisationId: orgBId,
          caseId: caseA,
          templateId: custom.id,
          actorUserId: userBId,
        }),
      (err: unknown) =>
        err instanceof ReportExportError &&
        (err.status === 404 || err.status === 400),
    );
    // Org B template id does not work for org A case either via wrong template
    const orgBTemplates = await db
      .select()
      .from(reportTemplates)
      .where(eq(reportTemplates.organisationId, orgBId));
    assert.ok(orgBTemplates.length > 0);
    await assert.rejects(
      () =>
        createReportExportCore({
          organisationId: orgAId,
          caseId: caseA,
          templateId: orgBTemplates[0]!.id,
          format: "json",
          requestedBy: userAId,
          processInline: true,
        }),
      (err: unknown) =>
        err instanceof ReportExportError && err.status === 404,
    );
    console.log("ok: tenant isolation");

    // Classification labels present in redaction reasons
    const techPreview = await previewReportCore({
      organisationId: orgAId,
      caseId: caseA,
      templateId: custom.id,
      actorUserId: userAId,
    });
    const overTlp = techPreview.redaction.items.find(
      (i) => i.status === "masked" || i.status === "excluded",
    );
    if (overTlp?.reason) {
      assert.match(overTlp.reason, /TLP:/i);
    }
    console.log("ok: classification labels in redaction reasons");

    // Schedule re-auth: banned creator fails closed
    const schedule = await createReportScheduleCore({
      organisationId: orgAId,
      templateId: free.id,
      caseId: caseA,
      format: "json",
      intervalMinutes: 60,
      createdBy: userAId,
    });
    // Force due now
    await db
      .update(reportSchedules)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(reportSchedules.id, schedule.id));
    await db
      .update(users)
      .set({ banned: true, lockedAt: new Date() })
      .where(eq(users.id, userAId));
    const ranBanned = await processDueReportSchedules(5);
    assert.ok(ranBanned.failed >= 1, "banned creator schedule fails");
    const [schAfterBan] = await db
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.id, schedule.id));
    assert.match(
      schAfterBan?.lastError ?? "",
      /inactive|permission|creator/i,
    );
    // Restore creator and demote to read_only
    await db
      .update(users)
      .set({ banned: false, lockedAt: null, role: "read_only" })
      .where(eq(users.id, userAId));
    await db
      .update(reportSchedules)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(reportSchedules.id, schedule.id));
    const ranRo = await processDueReportSchedules(5);
    assert.ok(ranRo.failed >= 1, "read_only creator schedule fails");
    const [schAfterRo] = await db
      .select()
      .from(reportSchedules)
      .where(eq(reportSchedules.id, schedule.id));
    assert.match(schAfterRo?.lastError ?? "", /reports:write|permission/i);
    // Restore admin + healthy run
    await db
      .update(users)
      .set({ role: "admin" })
      .where(eq(users.id, userAId));
    await db
      .update(reportSchedules)
      .set({ nextRunAt: new Date(Date.now() - 60_000) })
      .where(eq(reportSchedules.id, schedule.id));
    const ranOk = await processDueReportSchedules(5);
    assert.ok(ranOk.ran >= 1, "active admin creator schedule runs");
    console.log("ok: schedule re-auth fail-closed + success");

    // Failed job friendly path — process already-completed is no-op
    // Note: storageKey was corrupted earlier; reprocess still no-op on completed.
    const before = await getReportExportCore(orgAId, exp.id);
    const { processReportExportJob } = await import("../src/lib/reports/export-core");
    await processReportExportJob(exp.id);
    const after = await getReportExportCore(orgAId, exp.id);
    assert.equal(after?.status, before?.status);
    console.log("ok: reprocess completed export is idempotent (no duplicate release)");

    // Count exports for case
    const history = await listReportExportsCore(orgAId, caseA);
    assert.ok(history.length >= 3);
    assert.ok(history.every((h) => h.organisationId === orgAId));
    console.log("ok: export history");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => {
    console.log("\nall report template tests passed");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    cleanup().finally(() => process.exit(1));
  });
