/**
 * Coverage for structured investigation content blocks (issue #58):
 * Markdown sanitisation, append-only revisions, restore-as-new-head,
 * single-timeline reorder, comment promotion attribution, link
 * organisation+case authorisation, report inclusion defaults, and
 * tenant isolation. Calls `src/lib/content-blocks-core` against a real
 * Postgres instance (mirrors `scripts/test-investigations-core.ts`).
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import {
  alertEntities,
  alerts,
  alertSources,
  caseAlerts,
  caseContentBlockLinks,
  caseContentBlockRevisions,
  caseContentBlocks,
  caseTasks,
  cases,
  comments,
  entities,
  evidenceItems,
  organisations,
  timelineEvents,
  users,
} from "../src/db/schema";
import { newId } from "../src/lib/utils";
import {
  ContentBlockError,
  addContentBlockLinkCore,
  archiveContentBlockCore,
  createContentBlockCore,
  listContentBlockRevisionsCore,
  listContentBlocksCore,
  listReportContentBlocksCore,
  promoteCommentToContentBlockCore,
  reorderContentBlocksCore,
  restoreContentBlockRevisionCore,
  sanitizeContentMarkdown,
  updateContentBlockCore,
} from "../src/lib/content-blocks-core";
import { renderSafeMarkdown } from "../src/lib/markdown";
import { postCommentCore } from "../src/lib/comments-core";

const runId = newId("i58test").slice("i58test_".length).slice(0, 10);
const orgAId = `org_i58a_${runId}`;
const orgBId = `org_i58b_${runId}`;
const userAId = `user_i58a_${runId}`;
const userBId = `user_i58b_${runId}`;
const promoterId = `user_i58p_${runId}`;
let caseA = "";
let caseB = "";
let caseA2 = "";

async function setup() {
  await db.insert(organisations).values([
    { id: orgAId, name: "Content Blocks Org A", slug: `i58a-${runId}` },
    { id: orgBId, name: "Content Blocks Org B", slug: `i58b-${runId}` },
  ]);
  await db.insert(users).values([
    {
      id: userAId,
      name: "Analyst A",
      email: `i58a-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: promoterId,
      name: "Promoter P",
      email: `i58p-${runId}@example.com`,
      organisationId: orgAId,
      role: "analyst",
    },
    {
      id: userBId,
      name: "Analyst B",
      email: `i58b-${runId}@example.com`,
      organisationId: orgBId,
      role: "analyst",
    },
  ]);
  caseA = newId("case");
  caseA2 = newId("case");
  caseB = newId("case");
  await db.insert(cases).values([
    {
      id: caseA,
      organisationId: orgAId,
      caseNumber: `I58A-${runId}`,
      title: "Content blocks fixture A",
    },
    {
      id: caseA2,
      organisationId: orgAId,
      caseNumber: `I58A2-${runId}`,
      title: "Content blocks fixture A2",
    },
    {
      id: caseB,
      organisationId: orgBId,
      caseNumber: `I58B-${runId}`,
      title: "Content blocks fixture B",
    },
  ]);
}

async function cleanup() {
  for (const caseId of [caseA, caseA2, caseB]) {
    if (!caseId) continue;
    await db.delete(timelineEvents).where(eq(timelineEvents.caseId, caseId));
  }
  await db.delete(organisations).where(eq(organisations.id, orgAId));
  await db.delete(organisations).where(eq(organisations.id, orgBId));
}

// ── pure sanitisation ──────────────────────────────────────────────────

{
  const dirty = [
    "Finding: host was isolated",
    "<script>alert(1)</script>",
    '<img src=x onerror="alert(1)">',
    "See [payload](javascript:alert(1))",
    "Also data:text/html,hi and vbscript:msgbox(1)",
    "Normal **markdown** and [docs](https://example.com/path)",
  ].join("\n");
  const clean = sanitizeContentMarkdown(dirty);
  assert.equal(clean.includes("<script>"), false, "script tags must be stripped");
  assert.equal(clean.includes("<img"), false, "img tags must be stripped");
  assert.equal(clean.includes("javascript:"), false, "javascript: scheme must be neutralised");
  assert.equal(clean.includes("data:"), false, "data: scheme must be neutralised");
  assert.equal(clean.includes("vbscript:"), false, "vbscript: scheme must be neutralised");
  assert.match(clean, /Finding: host was isolated/);
  assert.match(clean, /\*\*markdown\*\*/);
  assert.match(clean, /https:\/\/example\.com\/path/);

  const rendered = renderSafeMarkdown(clean);
  assert.equal(rendered.toLowerCase().includes("onerror"), false);
  assert.equal(rendered.toLowerCase().includes("<script"), false);
  console.log("ok: markdown sanitisation strips HTML and dangerous schemes");
}

async function main() {
  await setup();
  try {
    // ── create + list order ────────────────────────────────────────────
    const b1 = await createContentBlockCore(orgAId, userAId, caseA, {
      type: "finding",
      title: "Initial foothold",
      content: "Attacker used **valid accounts**.\n<script>x</script>",
    });
    assert.equal(b1.sequenceIndex, 0);
    assert.equal(b1.revisionNumber, 1);
    assert.equal(b1.content.includes("<script>"), false, "create path sanitises content");
    assert.equal(b1.authorId, userAId);
    assert.equal(b1.includeInReport, true);
    assert.equal(b1.sensitive, false);

    const b2 = await createContentBlockCore(orgAId, userAId, caseA, {
      type: "decision",
      title: "Isolate host",
      content: "Containment approved",
      sensitive: true,
    });
    assert.equal(b2.sequenceIndex, 1);
    assert.equal(
      b2.includeInReport,
      false,
      "sensitive blocks default to exclude from report",
    );

    const b3 = await createContentBlockCore(orgAId, userAId, caseA, {
      type: "hypothesis",
      title: "Lateral movement path",
      content: "Possible RDP next",
      includeInReport: true,
    });
    assert.equal(b3.sequenceIndex, 2);

    const listed = await listContentBlocksCore(orgAId, caseA);
    assert.deepEqual(
      listed.map((b) => b.id),
      [b1.id, b2.id, b3.id],
      "list preserves sequence order",
    );
    console.log("ok: create/list preserves stable order and sanitises on write");

    // ── revisions append-only + restore creates new head ───────────────
    const updated = await updateContentBlockCore(orgAId, userAId, caseA, b1.id, {
      content: "Attacker used valid accounts (rev 2)",
      changeSummary: "clarify wording",
    });
    assert.equal(updated.revisionNumber, 2);
    assert.equal(updated.content, "Attacker used valid accounts (rev 2)");

    await updateContentBlockCore(orgAId, userAId, caseA, b1.id, {
      content: "Attacker used valid accounts (rev 3)",
    });

    const revs = await listContentBlockRevisionsCore(orgAId, caseA, b1.id);
    assert.equal(revs.length, 3, "create + 2 updates = 3 revisions");
    assert.deepEqual(
      revs.map((r) => r.revisionNumber),
      [1, 2, 3],
    );
    assert.match(revs[0]!.content, /valid accounts/);
    assert.equal(revs[1]!.changeSummary, "clarify wording");

    const restored = await restoreContentBlockRevisionCore(
      orgAId,
      userAId,
      caseA,
      b1.id,
      1,
    );
    assert.equal(restored.revisionNumber, 4, "restore creates new head revision");
    assert.match(restored.content, /valid accounts/);
    assert.equal(
      restored.content.includes("rev 2"),
      false,
      "restored body is revision 1 content",
    );

    const revsAfter = await listContentBlockRevisionsCore(orgAId, caseA, b1.id);
    assert.equal(revsAfter.length, 4, "history never loses earlier revisions");
    assert.equal(revsAfter[3]!.restoredFromRevision, 1);
    assert.equal(revsAfter[0]!.revisionNumber, 1);
    assert.equal(revsAfter[1]!.revisionNumber, 2);
    assert.equal(revsAfter[2]!.revisionNumber, 3);
    console.log("ok: revisions are append-only; restore creates a new head");

    // ── reorder writes one timeline event ──────────────────────────────
    const beforeReorder = await db
      .select({ id: timelineEvents.id })
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.caseId, caseA),
          eq(timelineEvents.eventType, "content_block_changed"),
        ),
      );
    const beforeCount = beforeReorder.length;

    const reordered = await reorderContentBlocksCore(
      orgAId,
      userAId,
      caseA,
      b3.id,
      0,
    );
    assert.deepEqual(
      reordered.map((b) => b.id),
      [b3.id, b1.id, b2.id],
      "b3 moves to front; relative order of the rest preserved",
    );

    const reorderEvents = await db
      .select({ payload: timelineEvents.payload })
      .from(timelineEvents)
      .where(
        and(
          eq(timelineEvents.caseId, caseA),
          eq(timelineEvents.eventType, "content_block_changed"),
        ),
      );
    const newEvents = reorderEvents.slice(beforeCount);
    const reorderOnly = newEvents.filter(
      (e) => (e.payload as { action?: string }).action === "reordered",
    );
    assert.equal(
      reorderOnly.length,
      1,
      "reorder must write exactly one timeline event",
    );
    assert.equal(
      (reorderOnly[0]!.payload as { block_id?: string }).block_id,
      b3.id,
    );
    console.log("ok: reorder produces a single timeline event");

    // ── comment promotion preserves attribution ────────────────────────
    const { id: commentId } = await postCommentCore(
      orgAId,
      { id: userAId, name: "Analyst A" },
      caseA,
      "Original comment body from the field analyst.",
    );
    const [commentRow] = await db
      .select()
      .from(comments)
      .where(eq(comments.id, commentId))
      .limit(1);
    assert.ok(commentRow);

    const promoted = await promoteCommentToContentBlockCore(
      orgAId,
      promoterId,
      caseA,
      commentId,
      { type: "investigation_note", title: "Field note" },
    );
    assert.equal(promoted.sourceCommentId, commentId);
    assert.equal(promoted.authorId, userAId, "original comment author preserved");
    assert.equal(promoted.originalAuthorId, userAId);
    assert.equal(promoted.promotedById, promoterId);
    assert.ok(promoted.promotedAt);
    assert.ok(promoted.originalCreatedAt);
    assert.equal(
      promoted.originalCreatedAt!.getTime(),
      commentRow!.createdAt.getTime(),
    );
    assert.match(promoted.content, /Original comment body/);

    await assert.rejects(
      () =>
        promoteCommentToContentBlockCore(orgAId, promoterId, caseA, commentId),
      (err: unknown) =>
        err instanceof ContentBlockError && err.status === 409,
    );
    console.log("ok: comment promotion preserves author, timestamp, source, promoter");

    // ── links are org+case authorised ──────────────────────────────────
    const taskId = newId("task");
    await db.insert(caseTasks).values({
      id: taskId,
      caseId: caseA,
      title: "Collect memory",
      orderIndex: 1,
    });
    const taskLink = await addContentBlockLinkCore(
      orgAId,
      userAId,
      caseA,
      b1.id,
      "task",
      taskId,
    );
    assert.equal(taskLink.targetId, taskId);

    const foreignTask = newId("task");
    await db.insert(caseTasks).values({
      id: foreignTask,
      caseId: caseB,
      title: "Org B task",
      orderIndex: 1,
    });
    await assert.rejects(
      () =>
        addContentBlockLinkCore(
          orgAId,
          userAId,
          caseA,
          b1.id,
          "task",
          foreignTask,
        ),
      (err: unknown) => err instanceof ContentBlockError && err.status === 404,
    );

    const sourceId = newId("asrc");
    await db.insert(alertSources).values({
      id: sourceId,
      organisationId: orgAId,
      kind: "microsoft_sentinel",
      name: "Sentinel",
    });
    const alertId = newId("alert");
    await db.insert(alerts).values({
      id: alertId,
      organisationId: orgAId,
      sourceId,
      externalId: `ext-${runId}`,
      title: "Alert A",
      severity: "high",
    });
    // Alert not yet linked to case → reject.
    await assert.rejects(
      () =>
        addContentBlockLinkCore(
          orgAId,
          userAId,
          caseA,
          b1.id,
          "alert",
          alertId,
        ),
      (err: unknown) => err instanceof ContentBlockError && err.status === 404,
    );
    await db.insert(caseAlerts).values({
      id: newId("calert"),
      organisationId: orgAId,
      caseId: caseA,
      alertId,
      isPrimary: true,
      addedBy: userAId,
    });
    const alertLink = await addContentBlockLinkCore(
      orgAId,
      userAId,
      caseA,
      b1.id,
      "alert",
      alertId,
    );
    assert.equal(alertLink.linkType, "alert");

    // Org B cannot list or mutate org A blocks.
    await assert.rejects(
      () => listContentBlocksCore(orgBId, caseA),
      (err: unknown) => err instanceof ContentBlockError && err.status === 404,
    );
    await assert.rejects(
      () =>
        updateContentBlockCore(orgBId, userBId, caseA, b1.id, {
          title: "hijack",
        }),
      (err: unknown) => err instanceof ContentBlockError && err.status === 404,
    );
    await assert.rejects(
      () =>
        addContentBlockLinkCore(
          orgBId,
          userBId,
          caseB,
          b1.id,
          "task",
          taskId,
        ),
      (err: unknown) => err instanceof ContentBlockError && err.status === 404,
    );
    console.log("ok: links and mutations enforce organisation + case authorisation");

    // ── evidence item + entity link authorisation ──────────────────────
    const entityId = newId("ent");
    await db.insert(entities).values({
      id: entityId,
      organisationId: orgAId,
      type: "ip",
      displayName: "203.0.113.9",
      canonicalKey: `ip:203.0.113.9:${runId}`,
    });
    // Entity not on case yet.
    await assert.rejects(
      () =>
        addContentBlockLinkCore(
          orgAId,
          userAId,
          caseA,
          b1.id,
          "entity",
          entityId,
        ),
      (err: unknown) => err instanceof ContentBlockError && err.status === 404,
    );
    await db.insert(alertEntities).values({
      id: newId("ae"),
      organisationId: orgAId,
      alertId,
      entityId,
      role: "related",
    });
    const entityLink = await addContentBlockLinkCore(
      orgAId,
      userAId,
      caseA,
      b1.id,
      "entity",
      entityId,
    );
    assert.equal(entityLink.targetId, entityId);

    const evidenceId = newId("evitem");
    await db.insert(evidenceItems).values({
      id: evidenceId,
      organisationId: orgAId,
      caseId: caseA,
      type: "log_excerpt",
      value: "failed logon storm",
      source: "analyst",
      createdBy: userAId,
    });
    const evidenceLink = await addContentBlockLinkCore(
      orgAId,
      userAId,
      caseA,
      b1.id,
      "evidence_item",
      evidenceId,
    );
    assert.equal(evidenceLink.targetId, evidenceId);

    const techLink = await addContentBlockLinkCore(
      orgAId,
      userAId,
      caseA,
      b1.id,
      "attack_technique",
      "t1059.001",
    );
    assert.equal(techLink.targetId, "T1059.001");
    console.log("ok: entity/evidence/technique links authorised correctly");

    // ── report inclusion filter ────────────────────────────────────────
    const reportBlocks = await listReportContentBlocksCore(orgAId, caseA);
    assert.ok(
      reportBlocks.every((b) => b.includeInReport && !b.sensitive),
      "default report selection excludes sensitive and includeInReport=false",
    );
    assert.ok(
      reportBlocks.some((b) => b.id === b1.id),
      "non-sensitive included block appears in report selection",
    );
    assert.equal(
      reportBlocks.some((b) => b.id === b2.id),
      false,
      "sensitive block excluded by default",
    );

    await archiveContentBlockCore(orgAId, userAId, caseA, b3.id);
    const afterArchive = await listContentBlocksCore(orgAId, caseA);
    assert.equal(
      afterArchive.some((b) => b.id === b3.id),
      false,
      "archived blocks hidden from default list",
    );
    const withArchived = await listContentBlocksCore(orgAId, caseA, {
      includeArchived: true,
    });
    assert.ok(withArchived.some((b) => b.id === b3.id));
    const reportAfterArchive = await listReportContentBlocksCore(orgAId, caseA);
    assert.equal(
      reportAfterArchive.some((b) => b.id === b3.id),
      false,
      "archived blocks never appear in reports",
    );
    console.log("ok: report inclusion respects sensitive flag, includeInReport, archive");

    // ── cross-case isolation within org ────────────────────────────────
    await assert.rejects(
      () =>
        updateContentBlockCore(orgAId, userAId, caseA2, b1.id, {
          title: "wrong case",
        }),
      (err: unknown) => err instanceof ContentBlockError && err.status === 404,
    );
    console.log("ok: blocks cannot be mutated via a different case id");

    console.log("content blocks core tests passed");
  } finally {
    // Manual cascade cleanup for tables that may not cascade from org delete
    // in partial-failure paths; organisations cascade covers the happy path.
    const blocks = await db
      .select({ id: caseContentBlocks.id })
      .from(caseContentBlocks)
      .where(inArray(caseContentBlocks.organisationId, [orgAId, orgBId]));
    const blockIds = blocks.map((b) => b.id);
    if (blockIds.length) {
      await db
        .delete(caseContentBlockLinks)
        .where(inArray(caseContentBlockLinks.blockId, blockIds));
      await db
        .delete(caseContentBlockRevisions)
        .where(inArray(caseContentBlockRevisions.blockId, blockIds));
      await db
        .delete(caseContentBlocks)
        .where(inArray(caseContentBlocks.id, blockIds));
    }
    await cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
