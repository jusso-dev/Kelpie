import type {
  CaseClassification,
  CaseSeverity,
} from "@/lib/cases-core";

export const MAILBOX_PROVIDERS = ["imap", "microsoft_graph"] as const;
export type MailboxProvider = (typeof MAILBOX_PROVIDERS)[number];

export const INTAKE_MODES = ["auto_create", "review"] as const;
export type IntakeMode = (typeof INTAKE_MODES)[number];

export const MESSAGE_STATUSES = [
  "pending_review",
  "imported",
  "dismissed",
  "failed",
  "duplicate",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type ImapConnectionMeta = {
  host: string;
  port: number;
  username: string;
  /** Always true in production paths; stored for diagnostics. */
  tls: true;
};

export type GraphConnectionMeta = {
  tenant_id: string;
  client_id: string;
  /** UPN or shared mailbox address. */
  mailbox: string;
};

export type MailboxConnectionMeta = ImapConnectionMeta | GraphConnectionMeta;

export type ImapSecrets = {
  password: string;
};

export type GraphSecrets = {
  client_secret: string;
};

export type MailboxSecrets = ImapSecrets | GraphSecrets;

export type MailAddress = {
  address: string;
  name?: string | null;
};

export type MailAttachmentDescriptor = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  /** Provider-specific id for later download (Graph). */
  providerAttachmentId?: string;
  /** Content-ID for inline parts. */
  contentId?: string;
  /** Raw bytes when already fetched (IMAP RFC822 parse / Graph $value). */
  content?: Buffer;
};

/**
 * Normalised inbound message independent of provider.
 * HTML is always pre-sanitised before reaching storage.
 */
export type NormalizedMailMessage = {
  providerMessageId: string;
  receivedAt: Date | null;
  sentAt: Date | null;
  from: MailAddress | null;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  bodyText: string;
  bodyHtmlSanitized: string;
  attachments: MailAttachmentDescriptor[];
  /** Original RFC822 / raw provider payload for evidence preservation. */
  rawMessage?: Buffer | null;
};

export type MailboxDefaults = {
  severity: CaseSeverity;
  classification: CaseClassification;
  assigneeId: string | null;
  templateId: string | null;
  tags: string[];
  intakeMode: IntakeMode;
};

export const MAILBOX_SOURCE_SYSTEM_PREFIX = "mailbox";

export function mailboxSourceSystem(connectionId: string): string {
  return `${MAILBOX_SOURCE_SYSTEM_PREFIX}:${connectionId}`;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_POLL_MESSAGES = 50;
