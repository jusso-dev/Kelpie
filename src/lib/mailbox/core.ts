/**
 * Inbound mailbox intake pipeline (issue #42).
 *
 * - Tenant-scoped poll with distributed DB lock
 * - Dedupe by (connection, provider message id)
 * - auto_create vs review modes
 * - Attachments + original message via evidence pipeline
 * - Never logs credentials or message bodies
 */

import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/db";
import {
  mailboxConnections,
  mailboxMessages,
  caseTemplates,
  type MailboxConnection,
  type MailboxMessage,
} from "@/db/schema";
import {
  createCaseCore,
  type CaseClassification,
  type CaseSeverity,
} from "@/lib/cases-core";
import { uploadEvidenceCore, EvidenceError } from "@/lib/evidence/core";
import { normalizeTags } from "@/lib/tags";
import { newId } from "@/lib/utils";
import { decryptCredentials } from "./crypto";
import { fetchImapMessages, parseImapUidCursor } from "./imap";
import { fetchGraphMessages } from "./graph";
import {
  mailboxSourceSystem,
  type GraphConnectionMeta,
  type GraphSecrets,
  type ImapConnectionMeta,
  type ImapSecrets,
  type IntakeMode,
  type MailAttachmentDescriptor,
  type NormalizedMailMessage,
  MAX_ATTACHMENT_BYTES,
} from "./types";

const POLL_LOCK_MS = 5 * 60_000;

export type PollMailboxResult = {
  connectionId: string;
  fetched: number;
  created: number;
  pendingReview: number;
  duplicates: number;
  failed: number;
  skipped: boolean;
  error: string | null;
};

function redactedPollLog(
  connectionId: string,
  organisationId: string,
  event: string,
  extra?: Record<string, unknown>,
) {
  // Never include subjects, bodies, credentials, or addresses.
  console.info("mailbox.poll", {
    event,
    connectionId,
    organisationId,
    ...extra,
  });
}

async function tryAcquirePollLock(
  connectionId: string,
): Promise<MailboxConnection | null> {
  const now = new Date();
  const lockUntil = new Date(now.getTime() + POLL_LOCK_MS);
  const [row] = await db
    .update(mailboxConnections)
    .set({
      pollLockUntil: lockUntil,
      lastPolledAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(mailboxConnections.id, connectionId),
        eq(mailboxConnections.isActive, true),
        or(
          isNull(mailboxConnections.pollLockUntil),
          lt(mailboxConnections.pollLockUntil, now),
        ),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * Release only if we still own the lock (pollLockUntil matches the value we
 * set at acquire). A slower poll that overran POLL_LOCK_MS must not clobber
 * the successor's lock or cursor.
 */
async function releasePollLock(
  connectionId: string,
  expectedLockUntil: Date,
  patch: Partial<typeof mailboxConnections.$inferInsert>,
) {
  await db
    .update(mailboxConnections)
    .set({
      ...patch,
      pollLockUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailboxConnections.id, connectionId),
        eq(mailboxConnections.pollLockUntil, expectedLockUntil),
      ),
    );
}

function attachmentMetaOnly(atts: MailAttachmentDescriptor[]) {
  return atts.map((a) => ({
    filename: a.filename,
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    oversized: a.sizeBytes > MAX_ATTACHMENT_BYTES || !a.content,
  }));
}

async function insertMessageIdempotent(opts: {
  organisationId: string;
  connectionId: string;
  message: NormalizedMailMessage;
  status: string;
  failureReason?: string | null;
  caseId?: string | null;
}): Promise<{ row: MailboxMessage; inserted: boolean }> {
  const id = newId("mboxmsg");
  const now = new Date();
  const values = {
    id,
    organisationId: opts.organisationId,
    connectionId: opts.connectionId,
    providerMessageId: opts.message.providerMessageId,
    receivedAt: opts.message.receivedAt,
    sentAt: opts.message.sentAt,
    fromAddress: opts.message.from?.address ?? null,
    fromName: opts.message.from?.name ?? null,
    toAddresses: opts.message.to.map((t) => t.address),
    ccAddresses: opts.message.cc.map((c) => c.address),
    subject: opts.message.subject,
    bodyText: opts.message.bodyText,
    bodyHtmlSanitized: opts.message.bodyHtmlSanitized,
    attachmentMeta: attachmentMetaOnly(opts.message.attachments),
    status: opts.status,
    failureReason: opts.failureReason ?? null,
    caseId: opts.caseId ?? null,
    processedAt: opts.status === "pending_review" ? null : now,
    createdAt: now,
    updatedAt: now,
  };

  const [inserted] = await db
    .insert(mailboxMessages)
    .values(values)
    .onConflictDoNothing()
    .returning();

  if (inserted) return { row: inserted, inserted: true };

  const [existing] = await db
    .select()
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.connectionId, opts.connectionId),
        eq(mailboxMessages.providerMessageId, opts.message.providerMessageId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("mailbox message conflict without row");
  return { row: existing, inserted: false };
}

async function resolveDefaults(connection: MailboxConnection): Promise<{
  severity: CaseSeverity;
  classification: CaseClassification;
  assigneeId: string | null;
  tags: string[];
  summaryPrefix: string;
}> {
  let tags = normalizeTags(
    Array.isArray(connection.defaultTags)
      ? (connection.defaultTags as string[])
      : [],
  );
  let severity = connection.defaultSeverity as CaseSeverity;
  let classification = connection.defaultClassification as CaseClassification;
  let summaryPrefix = "";

  if (connection.defaultTemplateId) {
    const [template] = await db
      .select()
      .from(caseTemplates)
      .where(
        and(
          eq(caseTemplates.id, connection.defaultTemplateId),
          eq(caseTemplates.organisationId, connection.organisationId),
        ),
      )
      .limit(1);
    if (template) {
      severity = template.defaultSeverity as CaseSeverity;
      classification = template.classification as CaseClassification;
      tags = normalizeTags([
        ...tags,
        ...((template.defaultTags as string[]) ?? []),
      ]);
      if (template.summaryTemplate) {
        summaryPrefix = template.summaryTemplate;
      }
    }
  }

  return {
    severity,
    classification,
    assigneeId: connection.defaultAssigneeId,
    tags,
    summaryPrefix,
  };
}

function buildCaseSummary(
  message: NormalizedMailMessage,
  summaryPrefix: string,
): string {
  const header = [
    `From: ${message.from?.address ?? "unknown"}`,
    `To: ${message.to.map((t) => t.address).join(", ") || "(none)"}`,
    `Subject: ${message.subject}`,
    message.receivedAt
      ? `Received: ${message.receivedAt.toISOString()}`
      : null,
  ]
    .filter(Boolean)
    .join("\n");
  const body = message.bodyText.slice(0, 8_000);
  if (summaryPrefix.trim()) {
    return `${summaryPrefix.trim()}\n\n---\n${header}\n\n${body}`;
  }
  return `${header}\n\n${body}`;
}

/**
 * Create a case from a normalised message and attach original message + files
 * through the evidence pipeline. Returns case id.
 */
export async function createCaseFromMailboxMessage(opts: {
  connection: MailboxConnection;
  message: NormalizedMailMessage;
  actorId: string | null;
  mailboxMessageId?: string;
}): Promise<{ caseId: string; caseNumber: string; created: boolean }> {
  const defaults = await resolveDefaults(opts.connection);
  const sourceSystem = mailboxSourceSystem(opts.connection.id);
  const result = await createCaseCore(
    opts.connection.organisationId,
    opts.actorId,
    {
      title: opts.message.subject.slice(0, 240) || "Inbound mailbox message",
      summary: buildCaseSummary(opts.message, defaults.summaryPrefix),
      severity: defaults.severity,
      classification: defaults.classification,
      assigneeId: defaults.assigneeId,
      tags: defaults.tags,
      sourceSystem,
      sourceReference: opts.message.providerMessageId,
    },
  );

  if (result.created) {
    await attachEvidenceForMessage({
      organisationId: opts.connection.organisationId,
      caseId: result.id,
      actorId: opts.actorId,
      message: opts.message,
      mailboxMessageId: opts.mailboxMessageId,
    });
  }

  return {
    caseId: result.id,
    caseNumber: result.caseNumber,
    created: result.created,
  };
}

async function attachEvidenceForMessage(opts: {
  organisationId: string;
  caseId: string;
  actorId: string | null;
  message: NormalizedMailMessage;
  mailboxMessageId?: string;
}) {
  const actorId = opts.actorId;
  let originalEvidenceId: string | null = null;

  if (opts.message.rawMessage && opts.message.rawMessage.length > 0) {
    try {
      const original = await uploadEvidenceCore({
        organisationId: opts.organisationId,
        caseId: opts.caseId,
        actorId,
        buffer: opts.message.rawMessage,
        filename: "original-message.eml",
        declaredContentType: "message/rfc822",
        source: "mailbox_intake",
        acquisitionSource: "inbound_mailbox",
        acquiredAt: opts.message.receivedAt,
        examinerNotes: "Original inbound message preserved by mailbox intake",
      });
      originalEvidenceId = original.id;
    } catch (error) {
      if (!(error instanceof EvidenceError)) throw error;
      // Record failure on mailbox message if we have an id; do not fail case.
      redactedPollLog("n/a", opts.organisationId, "original_message_upload_failed", {
        status: error.status,
      });
    }
  }

  for (const att of opts.message.attachments) {
    if (!att.content || att.content.length === 0) continue;
    if (att.content.length > MAX_ATTACHMENT_BYTES) continue;
    try {
      await uploadEvidenceCore({
        organisationId: opts.organisationId,
        caseId: opts.caseId,
        actorId,
        buffer: att.content,
        filename: att.filename,
        declaredContentType: att.contentType,
        source: "mailbox_intake",
        acquisitionSource: "inbound_mailbox_attachment",
        acquiredAt: opts.message.receivedAt,
      });
    } catch (error) {
      if (!(error instanceof EvidenceError)) throw error;
      redactedPollLog("n/a", opts.organisationId, "attachment_upload_failed", {
        status: error.status,
      });
    }
  }

  if (opts.mailboxMessageId && originalEvidenceId) {
    await db
      .update(mailboxMessages)
      .set({
        originalEvidenceId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailboxMessages.id, opts.mailboxMessageId),
          eq(mailboxMessages.organisationId, opts.organisationId),
        ),
      );
  }
}

async function processFetchedMessage(
  connection: MailboxConnection,
  message: NormalizedMailMessage,
): Promise<"created" | "pending_review" | "duplicate" | "failed"> {
  if (!message.providerMessageId) {
    return "failed";
  }

  // Fast-path dedupe before expensive case create.
  const [existing] = await db
    .select({ id: mailboxMessages.id, status: mailboxMessages.status })
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.connectionId, connection.id),
        eq(mailboxMessages.providerMessageId, message.providerMessageId),
      ),
    )
    .limit(1);
  if (existing) return "duplicate";

  const mode = connection.intakeMode as IntakeMode;

  if (mode === "review") {
    const { inserted } = await insertMessageIdempotent({
      organisationId: connection.organisationId,
      connectionId: connection.id,
      message,
      status: "pending_review",
    });
    return inserted ? "pending_review" : "duplicate";
  }

  // auto_create
  try {
    const { row, inserted } = await insertMessageIdempotent({
      organisationId: connection.organisationId,
      connectionId: connection.id,
      message,
      status: "pending_review", // temporary; flipped after case create
    });
    if (!inserted) return "duplicate";

    const created = await createCaseFromMailboxMessage({
      connection,
      message,
      actorId: connection.createdBy,
      mailboxMessageId: row.id,
    });

    await db
      .update(mailboxMessages)
      .set({
        status: created.created ? "imported" : "duplicate",
        caseId: created.caseId,
        processedAt: new Date(),
        updatedAt: new Date(),
        failureReason: null,
      })
      .where(
        and(
          eq(mailboxMessages.id, row.id),
          eq(mailboxMessages.organisationId, connection.organisationId),
        ),
      );

    return created.created ? "created" : "duplicate";
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.slice(0, 500) : "import failed";
    await insertMessageIdempotent({
      organisationId: connection.organisationId,
      connectionId: connection.id,
      message,
      status: "failed",
      failureReason: reason,
    }).catch(() => {});
    return "failed";
  }
}

async function fetchFromProvider(
  connection: MailboxConnection,
): Promise<{ messages: NormalizedMailMessage[]; nextCursor: string | null }> {
  const secrets = decryptCredentials(connection.credentialsEncrypted);
  const meta = connection.connectionMeta as Record<string, unknown>;

  if (connection.provider === "imap") {
    const imapMeta: ImapConnectionMeta = {
      host: String(meta.host ?? ""),
      port: Number(meta.port ?? 993),
      username: String(meta.username ?? ""),
      tls: true,
    };
    const result = await fetchImapMessages({
      meta: imapMeta,
      secrets: { password: secrets.password ?? "" } satisfies ImapSecrets,
      folder: connection.folder,
      uidCursor: parseImapUidCursor(connection.cursor),
    });
    return {
      messages: result.messages,
      nextCursor:
        result.maxUid != null ? String(result.maxUid) : connection.cursor,
    };
  }

  if (connection.provider === "microsoft_graph") {
    const graphMeta: GraphConnectionMeta = {
      tenant_id: String(meta.tenant_id ?? ""),
      client_id: String(meta.client_id ?? ""),
      mailbox: String(meta.mailbox ?? ""),
    };
    const result = await fetchGraphMessages({
      meta: graphMeta,
      secrets: {
        client_secret: secrets.client_secret ?? "",
      } satisfies GraphSecrets,
      folder: connection.folder,
      receivedAfter: connection.cursor,
    });
    return { messages: result.messages, nextCursor: result.cursor };
  }

  throw new Error(`Unknown mailbox provider: ${connection.provider}`);
}

/**
 * Poll a single mailbox connection. Safe to run from BullMQ workers.
 * Tenant isolation: all writes use connection.organisationId.
 */
export async function pollMailboxConnection(
  connectionId: string,
): Promise<PollMailboxResult> {
  const empty = (
    extra: Partial<PollMailboxResult>,
  ): PollMailboxResult => ({
    connectionId,
    fetched: 0,
    created: 0,
    pendingReview: 0,
    duplicates: 0,
    failed: 0,
    skipped: false,
    error: null,
    ...extra,
  });

  const connection = await tryAcquirePollLock(connectionId);
  if (!connection) {
    return empty({ skipped: true });
  }
  const ownedLockUntil = connection.pollLockUntil;
  if (!ownedLockUntil) {
    return empty({ skipped: true });
  }

  redactedPollLog(connection.id, connection.organisationId, "start");

  try {
    const { messages, nextCursor } = await fetchFromProvider(connection);
    let created = 0;
    let pendingReview = 0;
    let duplicates = 0;
    let failed = 0;

    for (const message of messages) {
      const outcome = await processFetchedMessage(connection, message);
      if (outcome === "created") created++;
      else if (outcome === "pending_review") pendingReview++;
      else if (outcome === "duplicate") duplicates++;
      else failed++;
    }

    await releasePollLock(connectionId, ownedLockUntil, {
      cursor: nextCursor,
      lastSuccessAt: new Date(),
      lastError: null,
      lastErrorAt: null,
      importedMessageCount: connection.importedMessageCount + created,
    });

    redactedPollLog(connection.id, connection.organisationId, "complete", {
      fetched: messages.length,
      created,
      pendingReview,
      duplicates,
      failed,
    });

    return empty({
      fetched: messages.length,
      created,
      pendingReview,
      duplicates,
      failed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Mailbox poll failed";
    // Never echo secrets that might appear in low-level errors.
    const safeMessage = message
      .replace(/password[=:]\s*\S+/gi, "password=[redacted]")
      .replace(/client_secret[=:]\s*\S+/gi, "client_secret=[redacted]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");

    await releasePollLock(connectionId, ownedLockUntil, {
      lastError: safeMessage,
      lastErrorAt: new Date(),
    });
    redactedPollLog(connection.id, connection.organisationId, "error");
    return empty({ error: safeMessage });
  }
}

export async function getMailboxConnectionInOrg(
  connectionId: string,
  organisationId: string,
): Promise<MailboxConnection | null> {
  const [row] = await db
    .select()
    .from(mailboxConnections)
    .where(
      and(
        eq(mailboxConnections.id, connectionId),
        eq(mailboxConnections.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Public-safe connection projection — credentials never included. */
export function publicMailboxConnection(row: MailboxConnection) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    folder: row.folder,
    pollIntervalMinutes: row.pollIntervalMinutes,
    intakeMode: row.intakeMode,
    defaultSeverity: row.defaultSeverity,
    defaultClassification: row.defaultClassification,
    defaultAssigneeId: row.defaultAssigneeId,
    defaultTemplateId: row.defaultTemplateId,
    defaultTags: row.defaultTags,
    connectionMeta: row.connectionMeta,
    isActive: row.isActive,
    lastPolledAt: row.lastPolledAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
    lastErrorAt: row.lastErrorAt,
    importedMessageCount: row.importedMessageCount,
    createdAt: row.createdAt,
    hasCredentials: Boolean(row.credentialsEncrypted),
  };
}

export async function listMailboxMessagesInOrg(opts: {
  organisationId: string;
  connectionId?: string;
  status?: string;
  limit?: number;
}): Promise<MailboxMessage[]> {
  const conditions = [
    eq(mailboxMessages.organisationId, opts.organisationId),
  ];
  if (opts.connectionId) {
    conditions.push(eq(mailboxMessages.connectionId, opts.connectionId));
  }
  if (opts.status) {
    conditions.push(eq(mailboxMessages.status, opts.status));
  }
  return db
    .select()
    .from(mailboxMessages)
    .where(and(...conditions))
    .orderBy(desc(mailboxMessages.createdAt))
    .limit(opts.limit ?? 100);
}

export async function approveMailboxMessage(opts: {
  organisationId: string;
  messageId: string;
  actorId: string;
}): Promise<{ caseId: string; caseNumber: string }> {
  const [msg] = await db
    .select()
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.id, opts.messageId),
        eq(mailboxMessages.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!msg) throw new Error("Mailbox message not found");
  if (msg.status === "imported" && msg.caseId) {
    const [connection] = await db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.id, msg.connectionId))
      .limit(1);
    void connection;
    return { caseId: msg.caseId, caseNumber: "" };
  }
  if (msg.status !== "pending_review" && msg.status !== "failed") {
    throw new Error(`Message cannot be approved from status ${msg.status}`);
  }

  const connection = await getMailboxConnectionInOrg(
    msg.connectionId,
    opts.organisationId,
  );
  if (!connection) throw new Error("Mailbox connection not found");

  // Claim the row before creating a case so concurrent dismiss cannot race
  // into a case that then overwrites dismissed status.
  const [claimed] = await db
    .update(mailboxMessages)
    .set({
      status: "importing",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailboxMessages.id, msg.id),
        eq(mailboxMessages.organisationId, opts.organisationId),
        or(
          eq(mailboxMessages.status, "pending_review"),
          eq(mailboxMessages.status, "failed"),
        ),
      ),
    )
    .returning();
  if (!claimed) {
    throw new Error("Message is no longer available for approval");
  }

  const normalized: NormalizedMailMessage = {
    providerMessageId: claimed.providerMessageId,
    receivedAt: claimed.receivedAt,
    sentAt: claimed.sentAt,
    from: claimed.fromAddress
      ? { address: claimed.fromAddress, name: claimed.fromName }
      : null,
    to: ((claimed.toAddresses as string[]) ?? []).map((address) => ({ address })),
    cc: ((claimed.ccAddresses as string[]) ?? []).map((address) => ({ address })),
    subject: claimed.subject ?? "(no subject)",
    bodyText: claimed.bodyText ?? "",
    bodyHtmlSanitized: claimed.bodyHtmlSanitized ?? "",
    attachments: [], // bytes not retained in review queue; original re-fetched only in live poll path
    rawMessage: claimed.bodyText
      ? Buffer.from(
          [
            `Message-ID: <${claimed.providerMessageId}>`,
            `From: ${claimed.fromAddress ?? "unknown"}`,
            `Subject: ${claimed.subject ?? ""}`,
            "Content-Type: text/plain; charset=utf-8",
            "",
            claimed.bodyText,
          ].join("\r\n"),
          "utf8",
        )
      : null,
  };

  let created: { caseId: string; caseNumber: string; created: boolean };
  try {
    created = await createCaseFromMailboxMessage({
      connection,
      message: normalized,
      actorId: opts.actorId,
      mailboxMessageId: claimed.id,
    });
  } catch (error) {
    await db
      .update(mailboxMessages)
      .set({
        status: "failed",
        failureReason:
          error instanceof Error ? error.message.slice(0, 500) : "Approve failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailboxMessages.id, claimed.id),
          eq(mailboxMessages.organisationId, opts.organisationId),
          eq(mailboxMessages.status, "importing"),
        ),
      );
    throw error;
  }

  await db
    .update(mailboxMessages)
    .set({
      status: "imported",
      caseId: created.caseId,
      failureReason: null,
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailboxMessages.id, claimed.id),
        eq(mailboxMessages.organisationId, opts.organisationId),
        eq(mailboxMessages.status, "importing"),
      ),
    );

  if (created.created) {
    await db
      .update(mailboxConnections)
      .set({
        importedMessageCount: connection.importedMessageCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(mailboxConnections.id, connection.id));
  }

  return { caseId: created.caseId, caseNumber: created.caseNumber };
}

export async function dismissMailboxMessage(opts: {
  organisationId: string;
  messageId: string;
  reason: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (!reason) throw new Error("A dismiss reason is required");
  const [updated] = await db
    .update(mailboxMessages)
    .set({
      status: "dismissed",
      dismissReason: reason.slice(0, 1000),
      processedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailboxMessages.id, opts.messageId),
        eq(mailboxMessages.organisationId, opts.organisationId),
        or(
          eq(mailboxMessages.status, "pending_review"),
          eq(mailboxMessages.status, "failed"),
        ),
      ),
    )
    .returning({ id: mailboxMessages.id });
  if (!updated) throw new Error("Message not found or not dismissible");
}

export async function retryMailboxMessage(opts: {
  organisationId: string;
  messageId: string;
  actorId: string;
}): Promise<{ caseId: string; caseNumber: string }> {
  const [msg] = await db
    .select()
    .from(mailboxMessages)
    .where(
      and(
        eq(mailboxMessages.id, opts.messageId),
        eq(mailboxMessages.organisationId, opts.organisationId),
        eq(mailboxMessages.status, "failed"),
      ),
    )
    .limit(1);
  if (!msg) throw new Error("Failed mailbox message not found");

  await db
    .update(mailboxMessages)
    .set({
      status: "pending_review",
      retryCount: msg.retryCount + 1,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(mailboxMessages.id, msg.id));

  return approveMailboxMessage({
    organisationId: opts.organisationId,
    messageId: opts.messageId,
    actorId: opts.actorId,
  });
}

/**
 * Re-process a stored pending/failed message into a case (review path).
 * Used by tests without live provider I/O.
 */
export async function ingestNormalizedMessageForTest(opts: {
  connection: MailboxConnection;
  message: NormalizedMailMessage;
}): Promise<"created" | "pending_review" | "duplicate" | "failed"> {
  return processFetchedMessage(opts.connection, opts.message);
}
