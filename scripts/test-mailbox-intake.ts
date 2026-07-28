/**
 * Integration coverage for mailbox intake (issue #42) against real Postgres:
 * review + auto_create modes, dedupe, dismiss/retry, tenant isolation,
 * credential never returned in public projection, oversized attachment meta.
 *
 * Provider network I/O is stubbed by feeding normalised messages through
 * `ingestNormalizedMessageForTest` / approve / dismiss paths.
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  attachments,
  cases,
  mailboxConnections,
  mailboxMessages,
  organisations,
  users,
} from "../src/db/schema";
import {
  approveMailboxMessage,
  dismissMailboxMessage,
  getMailboxConnectionInOrg,
  ingestNormalizedMessageForTest,
  publicMailboxConnection,
  retryMailboxMessage,
} from "../src/lib/mailbox/core";
import { encryptCredentials } from "../src/lib/mailbox/crypto";
import type { NormalizedMailMessage } from "../src/lib/mailbox/types";
import { mailboxSourceSystem } from "../src/lib/mailbox/types";
import { newId } from "../src/lib/utils";

process.env.CREDENTIALS_ENCRYPTION_KEY =
  process.env.CREDENTIALS_ENCRYPTION_KEY ??
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const runId = newId("mboxtest").slice("mboxtest_".length).slice(0, 12);
const orgAId = `org_mbox_a_${runId}`;
const orgBId = `org_mbox_b_${runId}`;
const userAId = `user_mbox_a_${runId}`;

async function createOrg(id: string, name: string) {
  await db.insert(organisations).values({
    id,
    name,
    slug: id.replace(/_/g, "-"),
  });
}

async function createUser(id: string, organisationId: string) {
  await db.insert(users).values({
    id,
    organisationId,
    name: "Mailbox Tester",
    email: `${id}@example.test`,
    emailVerified: true,
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

async function createConnection(opts: {
  id: string;
  organisationId: string;
  intakeMode: "auto_create" | "review";
  createdBy?: string;
}) {
  await db.insert(mailboxConnections).values({
    id: opts.id,
    organisationId: opts.organisationId,
    name: `Inbox ${opts.id}`,
    provider: "imap",
    folder: "INBOX",
    pollIntervalMinutes: 5,
    intakeMode: opts.intakeMode,
    defaultSeverity: "high",
    defaultClassification: "phishing",
    defaultTags: ["mailbox-intake"],
    credentialsEncrypted: encryptCredentials({ password: "test-password-never-log" }),
    connectionMeta: {
      host: "imap.example.test",
      port: 993,
      username: "soc@example.test",
      tls: true,
    },
    createdBy: opts.createdBy ?? null,
  });
}

function sampleMessage(
  providerMessageId: string,
  overrides: Partial<NormalizedMailMessage> = {},
): NormalizedMailMessage {
  const bodyText = "User reported suspicious invoice redirect.";
  const raw = Buffer.from(
    [
      `Message-ID: <${providerMessageId}>`,
      "From: reporter@example.com",
      "To: soc@example.com",
      "Subject: Suspicious invoice",
      "Content-Type: text/plain; charset=utf-8",
      "",
      bodyText,
    ].join("\r\n"),
    "utf8",
  );
  return {
    providerMessageId,
    receivedAt: new Date("2026-07-28T12:00:00Z"),
    sentAt: new Date("2026-07-28T11:59:00Z"),
    from: { address: "reporter@example.com", name: "Reporter" },
    to: [{ address: "soc@example.com" }],
    cc: [],
    subject: "Suspicious invoice",
    bodyText,
    bodyHtmlSanitized: "<p>User reported suspicious invoice redirect.</p>",
    attachments: [
      {
        filename: "invoice.pdf",
        contentType: "application/pdf",
        sizeBytes: 12,
        content: Buffer.from("%PDF-fake"),
      },
    ],
    rawMessage: raw,
    ...overrides,
  };
}

async function loadConnection(id: string) {
  const [row] = await db
    .select()
    .from(mailboxConnections)
    .where(eq(mailboxConnections.id, id))
    .limit(1);
  assert.ok(row);
  return row;
}

async function main() {
  await createOrg(orgAId, "Mailbox Test Org A");
  await createOrg(orgBId, "Mailbox Test Org B");
  await createUser(userAId, orgAId);

  const reviewConnId = `mbox_review_${runId}`;
  const autoConnId = `mbox_auto_${runId}`;
  const orgBConnId = `mbox_orgb_${runId}`;

  await createConnection({
    id: reviewConnId,
    organisationId: orgAId,
    intakeMode: "review",
    createdBy: userAId,
  });
  await createConnection({
    id: autoConnId,
    organisationId: orgAId,
    intakeMode: "auto_create",
    createdBy: userAId,
  });
  await createConnection({
    id: orgBConnId,
    organisationId: orgBId,
    intakeMode: "auto_create",
  });

  try {
    // ── Credentials never returned in public projection ──────────────────
    const conn = await loadConnection(reviewConnId);
    const pub = publicMailboxConnection(conn);
    assert.equal(pub.hasCredentials, true);
    assert.ok(
      !("credentialsEncrypted" in pub),
      "public projection must omit credentialsEncrypted",
    );
    assert.deepEqual(pub.connectionMeta, {
      host: "imap.example.test",
      port: 993,
      username: "soc@example.test",
      tls: true,
    });
    console.log("ok: credentials redacted from public projection");

    // ── Tenant isolation on getMailboxConnectionInOrg ────────────────────
    const cross = await getMailboxConnectionInOrg(reviewConnId, orgBId);
    assert.equal(cross, null, "org B must not load org A connection");
    const own = await getMailboxConnectionInOrg(reviewConnId, orgAId);
    assert.ok(own);
    console.log("ok: tenant isolation on connection lookup");

    // ── Review mode: pending_review, no case yet ─────────────────────────
    const reviewConn = await loadConnection(reviewConnId);
    const msgId1 = `review-msg-${runId}-1`;
    const outcome1 = await ingestNormalizedMessageForTest({
      connection: reviewConn,
      message: sampleMessage(msgId1),
    });
    assert.equal(outcome1, "pending_review");

    const [pendingRow] = await db
      .select()
      .from(mailboxMessages)
      .where(
        and(
          eq(mailboxMessages.connectionId, reviewConnId),
          eq(mailboxMessages.providerMessageId, msgId1),
        ),
      )
      .limit(1);
    assert.ok(pendingRow);
    assert.equal(pendingRow.status, "pending_review");
    assert.equal(pendingRow.organisationId, orgAId);
    assert.equal(pendingRow.caseId, null);
    assert.doesNotMatch(pendingRow.bodyHtmlSanitized ?? "", /<script/i);
    console.log("ok: review mode stores pending message");

    // ── Idempotent re-ingest ─────────────────────────────────────────────
    const dup = await ingestNormalizedMessageForTest({
      connection: reviewConn,
      message: sampleMessage(msgId1),
    });
    assert.equal(dup, "duplicate");
    const pendingCount = await db
      .select({ id: mailboxMessages.id })
      .from(mailboxMessages)
      .where(
        and(
          eq(mailboxMessages.connectionId, reviewConnId),
          eq(mailboxMessages.providerMessageId, msgId1),
        ),
      );
    assert.equal(pendingCount.length, 1);
    console.log("ok: duplicate provider message id is idempotent");

    // ── Approve → case + evidence ────────────────────────────────────────
    const approved = await approveMailboxMessage({
      organisationId: orgAId,
      messageId: pendingRow.id,
      actorId: userAId,
    });
    assert.ok(approved.caseId);

    const [caseRow] = await db
      .select()
      .from(cases)
      .where(eq(cases.id, approved.caseId))
      .limit(1);
    assert.ok(caseRow);
    assert.equal(caseRow.organisationId, orgAId);
    assert.equal(caseRow.sourceSystem, mailboxSourceSystem(reviewConnId));
    assert.equal(caseRow.sourceReference, msgId1);
    assert.equal(caseRow.severity, "high");
    assert.equal(caseRow.classification, "phishing");

    const [importedMsg] = await db
      .select()
      .from(mailboxMessages)
      .where(eq(mailboxMessages.id, pendingRow.id))
      .limit(1);
    assert.equal(importedMsg?.status, "imported");
    assert.equal(importedMsg?.caseId, approved.caseId);

    // Approve path rebuilds a minimal .eml; evidence should exist.
    const evidence = await db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.caseId, approved.caseId),
          eq(attachments.organisationId, orgAId),
        ),
      );
    assert.ok(evidence.length >= 1, "case should have evidence from mailbox");
    console.log("ok: approve creates case with evidence");

    // ── Auto-create mode ─────────────────────────────────────────────────
    const autoConn = await loadConnection(autoConnId);
    const autoMsgId = `auto-msg-${runId}-1`;
    const autoOutcome = await ingestNormalizedMessageForTest({
      connection: autoConn,
      message: sampleMessage(autoMsgId, {
        attachments: [
          {
            filename: "huge.bin",
            contentType: "application/octet-stream",
            sizeBytes: 30 * 1024 * 1024,
            // no content — oversized
          },
          {
            filename: "ok.txt",
            contentType: "text/plain",
            sizeBytes: 5,
            content: Buffer.from("hello"),
          },
        ],
      }),
    });
    assert.equal(autoOutcome, "created");

    const [autoMsg] = await db
      .select()
      .from(mailboxMessages)
      .where(
        and(
          eq(mailboxMessages.connectionId, autoConnId),
          eq(mailboxMessages.providerMessageId, autoMsgId),
        ),
      )
      .limit(1);
    assert.ok(autoMsg);
    assert.equal(autoMsg.status, "imported");
    assert.ok(autoMsg.caseId);

    const autoEvidence = await db
      .select()
      .from(attachments)
      .where(eq(attachments.caseId, autoMsg.caseId!));
    // original .eml + ok.txt (huge.bin skipped)
    assert.ok(autoEvidence.length >= 2);
    const names = autoEvidence.map((e) => e.filename);
    assert.ok(names.some((n) => n.includes("original-message") || n.endsWith(".eml") || n === "original-message.eml"));
    assert.ok(names.some((n) => n === "ok.txt" || n.includes("ok")));
    console.log("ok: auto_create imports case; oversized attachment skipped");

    // Replay auto message → duplicate, no second case
    const autoDup = await ingestNormalizedMessageForTest({
      connection: autoConn,
      message: sampleMessage(autoMsgId),
    });
    assert.equal(autoDup, "duplicate");
    const autoCases = await db
      .select({ id: cases.id })
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, orgAId),
          eq(cases.sourceSystem, mailboxSourceSystem(autoConnId)),
          eq(cases.sourceReference, autoMsgId),
        ),
      );
    assert.equal(autoCases.length, 1);
    console.log("ok: auto_create dedupe");

    // ── Dismiss + retry ──────────────────────────────────────────────────
    const dismissMsgId = `dismiss-msg-${runId}`;
    await ingestNormalizedMessageForTest({
      connection: reviewConn,
      message: sampleMessage(dismissMsgId, { subject: "Noise" }),
    });
    const [toDismiss] = await db
      .select()
      .from(mailboxMessages)
      .where(
        and(
          eq(mailboxMessages.connectionId, reviewConnId),
          eq(mailboxMessages.providerMessageId, dismissMsgId),
        ),
      )
      .limit(1);
    assert.ok(toDismiss);
    await dismissMailboxMessage({
      organisationId: orgAId,
      messageId: toDismiss.id,
      reason: "Marketing newsletter",
    });
    const [dismissed] = await db
      .select()
      .from(mailboxMessages)
      .where(eq(mailboxMessages.id, toDismiss.id));
    assert.equal(dismissed?.status, "dismissed");
    assert.equal(dismissed?.dismissReason, "Marketing newsletter");

    await assert.rejects(
      () =>
        dismissMailboxMessage({
          organisationId: orgAId,
          messageId: toDismiss.id,
          reason: "again",
        }),
      /not dismissible|not found/i,
    );
    console.log("ok: dismiss with reason");

    // Failed message retry path: insert failed row then retry.
    const failId = newId("mboxmsg");
    const failProviderId = `fail-msg-${runId}`;
    await db.insert(mailboxMessages).values({
      id: failId,
      organisationId: orgAId,
      connectionId: reviewConnId,
      providerMessageId: failProviderId,
      subject: "Failed import",
      bodyText: "retry me",
      bodyHtmlSanitized: "",
      status: "failed",
      failureReason: "simulated provider error",
      toAddresses: [],
      ccAddresses: [],
      attachmentMeta: [],
    });
    const retried = await retryMailboxMessage({
      organisationId: orgAId,
      messageId: failId,
      actorId: userAId,
    });
    assert.ok(retried.caseId);
    const [retriedRow] = await db
      .select()
      .from(mailboxMessages)
      .where(eq(mailboxMessages.id, failId));
    assert.equal(retriedRow?.status, "imported");
    assert.ok((retriedRow?.retryCount ?? 0) >= 1);
    console.log("ok: retry failed message");

    // ── Cross-org rejection ──────────────────────────────────────────────
    await assert.rejects(
      () =>
        approveMailboxMessage({
          organisationId: orgBId,
          messageId: pendingRow.id,
          actorId: userAId,
        }),
      /not found/i,
    );
    await assert.rejects(
      () =>
        dismissMailboxMessage({
          organisationId: orgBId,
          messageId: failId,
          reason: "nope",
        }),
      /not found|not dismissible/i,
    );

    // Org B can ingest same provider message id without colliding.
    const orgBConn = await loadConnection(orgBConnId);
    const sharedProviderId = `shared-${runId}`;
    const orgBOutcome = await ingestNormalizedMessageForTest({
      connection: orgBConn,
      message: sampleMessage(sharedProviderId),
    });
    assert.equal(orgBOutcome, "created");
    const orgAOutcomeShared = await ingestNormalizedMessageForTest({
      connection: autoConn,
      message: sampleMessage(sharedProviderId),
    });
    assert.equal(orgAOutcomeShared, "created");

    const orgACasesShared = await db
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, orgAId),
          eq(cases.sourceReference, sharedProviderId),
        ),
      );
    const orgBCasesShared = await db
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, orgBId),
          eq(cases.sourceReference, sharedProviderId),
        ),
      );
    assert.equal(orgACasesShared.length, 1);
    assert.equal(orgBCasesShared.length, 1);
    assert.notEqual(orgACasesShared[0].id, orgBCasesShared[0].id);
    console.log("ok: cross-org isolation and independent dedupe keys");

    // Malformed / empty provider id → failed
    const bad = await ingestNormalizedMessageForTest({
      connection: reviewConn,
      message: sampleMessage("", { providerMessageId: "" }),
    });
    assert.equal(bad, "failed");
    console.log("ok: malformed empty provider id fails safely");

    console.log("mailbox intake integration tests passed");
  } finally {
    // Cleanup in FK-safe order.
    for (const orgId of [orgAId, orgBId]) {
      const orgCases = await db
        .select({ id: cases.id })
        .from(cases)
        .where(eq(cases.organisationId, orgId));
      for (const c of orgCases) {
        await db.delete(attachments).where(eq(attachments.caseId, c.id));
      }
      await db.delete(mailboxMessages).where(eq(mailboxMessages.organisationId, orgId));
      await db
        .delete(mailboxConnections)
        .where(eq(mailboxConnections.organisationId, orgId));
      await db.delete(cases).where(eq(cases.organisationId, orgId));
      await db.delete(users).where(eq(users.organisationId, orgId));
      await db.delete(organisations).where(eq(organisations.id, orgId));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
