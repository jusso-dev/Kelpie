/**
 * Microsoft Graph mailbox polling for inbound intake.
 * Uses client-credentials against Graph mail folders (Mail.Read application).
 */

import { safeFetch } from "@/lib/outbound-request";
import {
  buildEmlFromParts,
  parseAddressList,
} from "./parse";
import {
  htmlToPlainText,
  sanitizeEmailHtml,
  truncateBody,
} from "./sanitize";
import type {
  GraphConnectionMeta,
  GraphSecrets,
  MailAttachmentDescriptor,
  NormalizedMailMessage,
} from "./types";
import { MAX_ATTACHMENT_BYTES, MAX_POLL_MESSAGES } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class GraphMailError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GraphMailError";
    this.status = status;
  }
}

export function validateGraphMeta(meta: GraphConnectionMeta): void {
  if (!meta.tenant_id?.trim()) throw new GraphMailError("Tenant ID is required");
  if (!meta.client_id?.trim()) throw new GraphMailError("Client ID is required");
  if (!meta.mailbox?.trim()) throw new GraphMailError("Mailbox address is required");
  if (!UUID_PATTERN.test(meta.tenant_id)) {
    throw new GraphMailError("Tenant ID must be a UUID");
  }
  if (!UUID_PATTERN.test(meta.client_id)) {
    throw new GraphMailError("Client ID must be a UUID");
  }
}

async function getAccessToken(
  meta: GraphConnectionMeta,
  secrets: GraphSecrets,
): Promise<string> {
  if (!secrets.client_secret?.trim()) {
    throw new GraphMailError("Client secret is required");
  }
  const body = new URLSearchParams({
    client_id: meta.client_id,
    client_secret: secrets.client_secret,
    grant_type: "client_credentials",
    scope: "https://graph.microsoft.com/.default",
  });
  const response = await safeFetch(
    `https://login.microsoftonline.com/${encodeURIComponent(meta.tenant_id)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new GraphMailError(
      `Microsoft identity token request failed (${response.status})`,
      response.status,
    );
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new GraphMailError("Microsoft identity response missing access token");
  }
  return payload.access_token;
}

type GraphRecipient = {
  emailAddress?: { name?: string; address?: string };
};

type GraphMessage = {
  id?: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  from?: GraphRecipient;
  toRecipients?: GraphRecipient[];
  ccRecipients?: GraphRecipient[];
  receivedDateTime?: string;
  sentDateTime?: string;
  hasAttachments?: boolean;
};

type GraphAttachment = {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  contentBytes?: string;
  "@odata.type"?: string;
  isInline?: boolean;
};

function mapRecipients(list: GraphRecipient[] | undefined) {
  return (list ?? [])
    .map((r) => ({
      address: (r.emailAddress?.address ?? "").trim().toLowerCase(),
      name: r.emailAddress?.name ?? null,
    }))
    .filter((r) => r.address);
}

function folderPath(folder: string): string {
  const f = folder.trim() || "INBOX";
  // Well-known folder names map to Graph well-known names.
  const wellKnown: Record<string, string> = {
    inbox: "inbox",
    junkemail: "junkemail",
    junk: "junkemail",
    deleteditems: "deleteditems",
    archive: "archive",
    sentitems: "sentitems",
  };
  const key = f.toLowerCase().replace(/\s+/g, "");
  if (wellKnown[key]) return wellKnown[key];
  // Custom folder display name — use filter by displayName via mailFolders.
  return f;
}

export type FetchGraphOptions = {
  meta: GraphConnectionMeta;
  secrets: GraphSecrets;
  folder: string;
  /** ISO timestamp cursor — fetch messages received after this. */
  receivedAfter?: string | null;
  limit?: number;
};

export async function fetchGraphMessages(
  opts: FetchGraphOptions,
): Promise<{ messages: NormalizedMailMessage[]; cursor: string | null }> {
  validateGraphMeta(opts.meta);
  const token = await getAccessToken(opts.meta, opts.secrets);
  const mailbox = encodeURIComponent(opts.meta.mailbox.trim());
  const folder = folderPath(opts.folder);
  const limit = Math.min(opts.limit ?? MAX_POLL_MESSAGES, MAX_POLL_MESSAGES);

  const filters: string[] = [];
  if (opts.receivedAfter) {
    // Graph prefers full ISO timestamps.
    filters.push(`receivedDateTime gt ${opts.receivedAfter}`);
  }
  const filterQs = filters.length
    ? `&$filter=${encodeURIComponent(filters.join(" and "))}`
    : "";

  const listUrl =
    `https://graph.microsoft.com/v1.0/users/${mailbox}/mailFolders/${encodeURIComponent(folder)}/messages` +
    `?$top=${limit}&$orderby=${encodeURIComponent("receivedDateTime asc")}` +
    `&$select=${encodeURIComponent(
      "id,internetMessageId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments",
    )}` +
    filterQs;

  const listRes = await safeFetch(listUrl, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      prefer: 'outlook.body-content-type="text"',
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!listRes.ok) {
    throw new GraphMailError(
      `Graph mail list failed (${listRes.status})`,
      listRes.status,
    );
  }
  const listPayload = (await listRes.json()) as { value?: GraphMessage[] };
  const items = listPayload.value ?? [];
  const messages: NormalizedMailMessage[] = [];
  let maxReceived: string | null = opts.receivedAfter ?? null;

  for (const item of items) {
    if (!item.id) continue;
    const providerMessageId =
      item.internetMessageId?.replace(/^<|>$/g, "").trim() || item.id;

    // Prefer HTML body fetch when text-prefer returned empty body.
    let bodyText = "";
    let bodyHtml = "";
    if (item.body?.contentType?.toLowerCase() === "html") {
      bodyHtml = item.body.content ?? "";
      bodyText = htmlToPlainText(bodyHtml);
    } else {
      bodyText = item.body?.content ?? item.bodyPreview ?? "";
    }

    // If we only got text, still try to get HTML for sanitised storage.
    if (!bodyHtml) {
      try {
        const htmlRes = await safeFetch(
          `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${encodeURIComponent(item.id)}?$select=body`,
          {
            headers: {
              authorization: `Bearer ${token}`,
              accept: "application/json",
              prefer: 'outlook.body-content-type="html"',
            },
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (htmlRes.ok) {
          const htmlPayload = (await htmlRes.json()) as GraphMessage;
          if (htmlPayload.body?.contentType?.toLowerCase() === "html") {
            bodyHtml = htmlPayload.body.content ?? "";
          }
        }
      } catch {
        // Keep text-only; HTML is optional.
      }
    }

    const attachments: MailAttachmentDescriptor[] = [];
    if (item.hasAttachments) {
      const attRes = await safeFetch(
        `https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${encodeURIComponent(item.id)}/attachments`,
        {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/json",
          },
          signal: AbortSignal.timeout(45_000),
        },
      );
      if (attRes.ok) {
        const attPayload = (await attRes.json()) as { value?: GraphAttachment[] };
        for (const att of attPayload.value ?? []) {
          if (att["@odata.type"] && !att["@odata.type"].includes("fileAttachment")) {
            continue;
          }
          const size = att.size ?? 0;
          const filename = att.name?.trim() || "attachment";
          const contentType = att.contentType || "application/octet-stream";
          let content: Buffer | undefined;
          if (att.contentBytes && size <= MAX_ATTACHMENT_BYTES) {
            try {
              content = Buffer.from(att.contentBytes, "base64");
            } catch {
              content = undefined;
            }
          }
          attachments.push({
            filename,
            contentType,
            sizeBytes: size,
            providerAttachmentId: att.id,
            content,
          });
        }
      }
    }

    const fromAddr = item.from?.emailAddress?.address?.toLowerCase() ?? "";
    const fromName = item.from?.emailAddress?.name ?? null;
    const to = mapRecipients(item.toRecipients);
    const cc = mapRecipients(item.ccRecipients);
    const receivedAt = item.receivedDateTime
      ? new Date(item.receivedDateTime)
      : null;
    const sentAt = item.sentDateTime ? new Date(item.sentDateTime) : null;

    const sanitized = sanitizeEmailHtml(bodyHtml);
    const rawMessage = buildEmlFromParts({
      messageId: providerMessageId,
      subject: item.subject ?? "(no subject)",
      from: fromAddr
        ? fromName
          ? `"${fromName}" <${fromAddr}>`
          : fromAddr
        : "unknown@invalid",
      to: to.map((t) => t.address),
      cc: cc.map((c) => c.address),
      date: receivedAt ?? sentAt,
      bodyText,
      bodyHtml,
    });

    messages.push({
      providerMessageId,
      receivedAt,
      sentAt,
      from: fromAddr ? { address: fromAddr, name: fromName } : null,
      to,
      cc,
      subject: (item.subject ?? "").trim() || "(no subject)",
      bodyText: truncateBody(bodyText),
      bodyHtmlSanitized: truncateBody(sanitized),
      attachments,
      rawMessage,
    });

    if (item.receivedDateTime) {
      if (!maxReceived || item.receivedDateTime > maxReceived) {
        maxReceived = item.receivedDateTime;
      }
    }
  }

  return { messages, cursor: maxReceived };
}

/** Exported for unit tests that map Graph payloads without network. */
export function mapGraphMessageForTest(item: GraphMessage): NormalizedMailMessage {
  const fromAddr = item.from?.emailAddress?.address?.toLowerCase() ?? "";
  const bodyHtml =
    item.body?.contentType?.toLowerCase() === "html"
      ? (item.body.content ?? "")
      : "";
  const bodyText =
    item.body?.contentType?.toLowerCase() === "html"
      ? htmlToPlainText(bodyHtml)
      : (item.body?.content ?? item.bodyPreview ?? "");
  return {
    providerMessageId:
      item.internetMessageId?.replace(/^<|>$/g, "").trim() || item.id || "unknown",
    receivedAt: item.receivedDateTime ? new Date(item.receivedDateTime) : null,
    sentAt: item.sentDateTime ? new Date(item.sentDateTime) : null,
    from: fromAddr
      ? { address: fromAddr, name: item.from?.emailAddress?.name ?? null }
      : null,
    to: mapRecipients(item.toRecipients),
    cc: mapRecipients(item.ccRecipients),
    subject: (item.subject ?? "").trim() || "(no subject)",
    bodyText: truncateBody(bodyText),
    bodyHtmlSanitized: truncateBody(sanitizeEmailHtml(bodyHtml)),
    attachments: [],
    rawMessage: null,
  };
}

// Keep parseAddressList imported for potential header-path reuse in tests.
void parseAddressList;
