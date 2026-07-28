import { db } from "@/db";
import { auditEvents } from "@/db/schema";
import { newId } from "@/lib/utils";
import { redactAuditSnapshot } from "./redact";

export type AuditActorType = "user" | "api_token" | "system" | "external";

export interface AuditContext {
  requestId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
}

export interface RecordAuditEventInput extends AuditContext {
  organisationId: string;
  actorId?: string | null;
  actorType: AuditActorType;
  actorLabel?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * The single write path for `audit_events`. Every mutation call site across
 * the app (auth, team, settings, integrations, tokens, cases, tasks,
 * observables, evidence, tags, fields, jobs, exports) should funnel through
 * this function rather than inserting into `auditEvents` directly, so
 * redaction and shape stay consistent in one place.
 */
export async function recordAuditEvent(input: RecordAuditEventInput): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId("audit"),
    organisationId: input.organisationId,
    actorId: input.actorId ?? null,
    actorType: input.actorType,
    actorLabel: input.actorLabel ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    requestId: input.requestId ?? null,
    sourceIp: input.sourceIp ?? null,
    userAgent: input.userAgent ?? null,
    before: redactAuditSnapshot(input.before),
    after: redactAuditSnapshot(input.after),
    metadata: redactAuditSnapshot(input.metadata) ?? {},
  });
}
