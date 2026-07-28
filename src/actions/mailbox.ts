"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { caseTemplates, mailboxConnections, users } from "@/db/schema";
import { CASE_ENUMS } from "@/lib/cases-core";
import { encryptCredentials } from "@/lib/mailbox/crypto";
import {
  approveMailboxMessage,
  dismissMailboxMessage,
  getMailboxConnectionInOrg,
  pollMailboxConnection,
  publicMailboxConnection,
  retryMailboxMessage,
} from "@/lib/mailbox/core";
import { assertSafeImapHost } from "@/lib/mailbox/imap";
import {
  INTAKE_MODES,
  MAILBOX_PROVIDERS,
  type GraphConnectionMeta,
  type ImapConnectionMeta,
  type IntakeMode,
  type MailboxProvider,
} from "@/lib/mailbox/types";
import { requireRole } from "@/lib/session";
import { normalizeTags } from "@/lib/tags";
import { newId } from "@/lib/utils";

function formValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function parseProvider(raw: string): MailboxProvider {
  if ((MAILBOX_PROVIDERS as readonly string[]).includes(raw)) {
    return raw as MailboxProvider;
  }
  throw new Error("Mailbox provider is invalid");
}

function parseIntakeMode(raw: string): IntakeMode {
  if ((INTAKE_MODES as readonly string[]).includes(raw)) {
    return raw as IntakeMode;
  }
  throw new Error("Intake mode is invalid");
}

function parseSeverity(raw: string) {
  if ((CASE_ENUMS.severity as readonly string[]).includes(raw)) {
    return raw as (typeof CASE_ENUMS.severity)[number];
  }
  return "medium" as const;
}

function parseClassification(raw: string) {
  if ((CASE_ENUMS.classification as readonly string[]).includes(raw)) {
    return raw as (typeof CASE_ENUMS.classification)[number];
  }
  return "other" as const;
}

function buildImapMeta(formData: FormData): ImapConnectionMeta {
  const host = formValue(formData, "host").trim();
  const port = Number(formValue(formData, "port") || "993");
  const username = formValue(formData, "username");
  if (!host) throw new Error("IMAP host is required");
  // Block credentials-in-host and path-shaped hosts before DNS policy.
  if (/[/\s@]/.test(host) || host.includes("://")) {
    throw new Error("IMAP host must be a bare hostname or IP");
  }
  if (!username) throw new Error("IMAP username is required");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("IMAP port is invalid");
  }
  return { host, port, username, tls: true };
}

function buildGraphMeta(formData: FormData): GraphConnectionMeta {
  const tenant_id = formValue(formData, "tenant_id");
  const client_id = formValue(formData, "client_id");
  const mailbox = formValue(formData, "mailbox");
  if (!tenant_id || !client_id || !mailbox) {
    throw new Error("Microsoft Graph tenant, client ID, and mailbox are required");
  }
  return { tenant_id, client_id, mailbox };
}

export async function createMailboxConnection(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = formValue(formData, "name");
  if (!name) throw new Error("Name is required");

  const provider = parseProvider(formValue(formData, "provider") || "imap");
  const intakeMode = parseIntakeMode(
    formValue(formData, "intake_mode") || "review",
  );
  const interval = Number(formValue(formData, "poll_interval_minutes") || "5");
  if (!Number.isInteger(interval) || interval < 1 || interval > 10080) {
    throw new Error("Poll interval must be between 1 minute and 7 days");
  }
  const folder = formValue(formData, "folder") || "INBOX";

  let connectionMeta: ImapConnectionMeta | GraphConnectionMeta;
  let credentialsEncrypted: string;

  if (provider === "imap") {
    connectionMeta = buildImapMeta(formData);
    await assertSafeImapHost(connectionMeta.host);
    const password = formValue(formData, "password");
    if (!password) throw new Error("IMAP password is required");
    credentialsEncrypted = encryptCredentials({ password });
  } else {
    connectionMeta = buildGraphMeta(formData);
    const client_secret = formValue(formData, "client_secret");
    if (!client_secret) throw new Error("Client secret is required");
    credentialsEncrypted = encryptCredentials({ client_secret });
  }

  const defaultAssigneeId = formValue(formData, "default_assignee_id") || null;
  if (defaultAssigneeId) {
    const [assignee] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, defaultAssigneeId),
          eq(users.organisationId, user.organisationId),
        ),
      )
      .limit(1);
    if (!assignee) throw new Error("Default assignee not found in organisation");
  }

  const defaultTemplateId = formValue(formData, "default_template_id") || null;
  if (defaultTemplateId) {
    const [template] = await db
      .select({ id: caseTemplates.id })
      .from(caseTemplates)
      .where(
        and(
          eq(caseTemplates.id, defaultTemplateId),
          eq(caseTemplates.organisationId, user.organisationId),
        ),
      )
      .limit(1);
    if (!template) throw new Error("Default template not found in organisation");
  }

  const tagsRaw = formValue(formData, "default_tags");
  const defaultTags = normalizeTags(
    tagsRaw
      ? tagsRaw.split(/[,\n]/).map((t) => t.trim()).filter(Boolean)
      : [],
  );

  await db.insert(mailboxConnections).values({
    id: newId("mbox"),
    organisationId: user.organisationId,
    name,
    provider,
    folder,
    pollIntervalMinutes: interval,
    intakeMode,
    defaultSeverity: parseSeverity(formValue(formData, "default_severity")),
    defaultClassification: parseClassification(
      formValue(formData, "default_classification"),
    ),
    defaultAssigneeId,
    defaultTemplateId,
    defaultTags,
    credentialsEncrypted,
    connectionMeta,
    createdBy: user.id,
  });

  revalidatePath("/settings/integrations");
  revalidatePath("/settings/mailbox");
}

export async function updateMailboxConnectionCredentials(
  id: string,
  formData: FormData,
) {
  const user = await requireRole(["admin"]);
  const connection = await getMailboxConnectionInOrg(id, user.organisationId);
  if (!connection) throw new Error("Mailbox connection not found");

  if (connection.provider === "imap") {
    const password = formValue(formData, "password");
    if (!password) throw new Error("IMAP password is required");
    await db
      .update(mailboxConnections)
      .set({
        credentialsEncrypted: encryptCredentials({ password }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailboxConnections.id, id),
          eq(mailboxConnections.organisationId, user.organisationId),
        ),
      );
  } else {
    const client_secret = formValue(formData, "client_secret");
    if (!client_secret) throw new Error("Client secret is required");
    await db
      .update(mailboxConnections)
      .set({
        credentialsEncrypted: encryptCredentials({ client_secret }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(mailboxConnections.id, id),
          eq(mailboxConnections.organisationId, user.organisationId),
        ),
      );
  }

  revalidatePath("/settings/integrations");
  revalidatePath("/settings/mailbox");
}

export async function setMailboxConnectionActive(id: string, active: boolean) {
  const user = await requireRole(["admin"]);
  await db
    .update(mailboxConnections)
    .set({
      isActive: active,
      lastError: active ? null : undefined,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mailboxConnections.id, id),
        eq(mailboxConnections.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
  revalidatePath("/settings/mailbox");
}

export async function deleteMailboxConnection(id: string) {
  const user = await requireRole(["admin"]);
  await db
    .delete(mailboxConnections)
    .where(
      and(
        eq(mailboxConnections.id, id),
        eq(mailboxConnections.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/settings/integrations");
  revalidatePath("/settings/mailbox");
}

export async function pollMailboxNow(id: string) {
  const user = await requireRole(["admin"]);
  const connection = await getMailboxConnectionInOrg(id, user.organisationId);
  if (!connection) throw new Error("Mailbox connection not found");
  const result = await pollMailboxConnection(id);
  revalidatePath("/settings/integrations");
  revalidatePath("/settings/mailbox");
  revalidatePath("/cases");
  if (result.error) throw new Error(result.error);
  return {
    fetched: result.fetched,
    created: result.created,
    pendingReview: result.pendingReview,
    duplicates: result.duplicates,
    failed: result.failed,
    skipped: result.skipped,
  };
}

export async function approveMailboxMessageAction(messageId: string) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await approveMailboxMessage({
    organisationId: user.organisationId,
    messageId,
    actorId: user.id,
  });
  revalidatePath("/settings/mailbox");
  revalidatePath("/cases");
  return result;
}

export async function dismissMailboxMessageAction(
  messageId: string,
  reason: string,
) {
  const user = await requireRole(["admin", "analyst"]);
  await dismissMailboxMessage({
    organisationId: user.organisationId,
    messageId,
    reason,
  });
  revalidatePath("/settings/mailbox");
}

export async function retryMailboxMessageAction(messageId: string) {
  const user = await requireRole(["admin", "analyst"]);
  const result = await retryMailboxMessage({
    organisationId: user.organisationId,
    messageId,
    actorId: user.id,
  });
  revalidatePath("/settings/mailbox");
  revalidatePath("/cases");
  return result;
}

/** Safe list for UI — never includes credentialsEncrypted. */
export async function listPublicMailboxConnections() {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  const rows = await db
    .select()
    .from(mailboxConnections)
    .where(eq(mailboxConnections.organisationId, user.organisationId));
  return rows.map(publicMailboxConnection);
}
