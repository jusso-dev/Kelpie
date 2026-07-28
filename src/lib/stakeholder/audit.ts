/**
 * Dual write: case-scoped stakeholder_access_events + org audit_events.
 */

import { db } from "@/db";
import { stakeholderAccessEvents } from "@/db/schema";
import { newId } from "@/lib/utils";
import { recordAuditEvent } from "@/lib/audit/events";

export type StakeholderAuditInput = {
  organisationId: string;
  caseId: string;
  invitationId?: string | null;
  collaboratorId?: string | null;
  sessionId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  /** Display label for org audit trail (email or name — never tokens). */
  actorLabel?: string | null;
};

export async function recordStakeholderAccess(
  input: StakeholderAuditInput,
): Promise<void> {
  await db.insert(stakeholderAccessEvents).values({
    id: newId("stk_evt"),
    organisationId: input.organisationId,
    caseId: input.caseId,
    invitationId: input.invitationId ?? null,
    collaboratorId: input.collaboratorId ?? null,
    sessionId: input.sessionId ?? null,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? {},
    sourceIp: input.sourceIp ?? null,
    userAgent: input.userAgent ?? null,
  });

  // audit_events.actor_id FKs to users — external collaborators are never users.
  // Identity lives in actorLabel + metadata.collaborator_id.
  await recordAuditEvent({
    organisationId: input.organisationId,
    actorId: null,
    actorType: "external",
    actorLabel: input.actorLabel ?? null,
    action: `stakeholder.${input.action}`,
    targetType: input.targetType ?? "case",
    targetId: input.targetId ?? input.caseId,
    metadata: {
      invitation_id: input.invitationId ?? null,
      session_id: input.sessionId ?? null,
      collaborator_id: input.collaboratorId ?? null,
      ...(input.metadata ?? {}),
    },
    sourceIp: input.sourceIp ?? null,
    userAgent: input.userAgent ?? null,
  });
}
