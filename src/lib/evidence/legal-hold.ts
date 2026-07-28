import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { attachments, cases, evidenceLegalHolds, type EvidenceLegalHold } from "@/db/schema";
import { newId } from "@/lib/utils";
import { recordCustodyEvent } from "./custody";

export class LegalHoldError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "LegalHoldError";
    this.status = status;
  }
}

/** True if the case or the evidence item itself has an unreleased hold. */
export async function isUnderActiveHold(
  organisationId: string,
  target: { caseId: string; evidenceId?: string | null },
): Promise<boolean> {
  const conditions = [eq(evidenceLegalHolds.caseId, target.caseId)];
  if (target.evidenceId) {
    conditions.push(eq(evidenceLegalHolds.evidenceId, target.evidenceId));
  }
  const [row] = await db
    .select({ id: evidenceLegalHolds.id })
    .from(evidenceLegalHolds)
    .where(
      and(
        eq(evidenceLegalHolds.organisationId, organisationId),
        isNull(evidenceLegalHolds.releasedAt),
        or(...conditions),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export type ApplyLegalHoldInput = {
  organisationId: string;
  actorId: string;
  reason: string;
  caseId?: string | null;
  evidenceId?: string | null;
};

export async function applyLegalHoldCore(
  input: ApplyLegalHoldInput,
): Promise<EvidenceLegalHold> {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    throw new LegalHoldError("A reason is required to apply a legal hold", 400);
  }
  if (!input.caseId && !input.evidenceId) {
    throw new LegalHoldError("A legal hold must target a case or an evidence item", 400);
  }

  let resolvedCaseId = input.caseId ?? null;
  if (input.evidenceId) {
    const [evidence] = await db
      .select({ id: attachments.id, caseId: attachments.caseId })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, input.evidenceId),
          eq(attachments.organisationId, input.organisationId),
        ),
      )
      .limit(1);
    if (!evidence) throw new LegalHoldError("Evidence not found", 404);
    resolvedCaseId = resolvedCaseId ?? evidence.caseId;
  }
  if (input.caseId) {
    const [c] = await db
      .select({ id: cases.id })
      .from(cases)
      .where(and(eq(cases.id, input.caseId), eq(cases.organisationId, input.organisationId)))
      .limit(1);
    if (!c) throw new LegalHoldError("Case not found", 404);
  }

  const id = newId("hold");
  const [row] = await db
    .insert(evidenceLegalHolds)
    .values({
      id,
      organisationId: input.organisationId,
      caseId: input.caseId ?? null,
      evidenceId: input.evidenceId ?? null,
      reason,
      appliedBy: input.actorId,
    })
    .returning();
  if (!row) throw new LegalHoldError("Failed to apply legal hold", 500);

  if (input.evidenceId) {
    await recordCustodyEvent({
      evidenceId: input.evidenceId,
      organisationId: input.organisationId,
      actorId: input.actorId,
      eventType: "legal_hold_applied",
      reason,
      payload: { hold_id: id, scope: "evidence" },
    });
  } else if (resolvedCaseId) {
    const caseEvidence = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.caseId, resolvedCaseId),
          eq(attachments.organisationId, input.organisationId),
        ),
      );
    for (const item of caseEvidence) {
      await recordCustodyEvent({
        evidenceId: item.id,
        organisationId: input.organisationId,
        actorId: input.actorId,
        eventType: "legal_hold_applied",
        reason,
        payload: { hold_id: id, scope: "case", case_id: resolvedCaseId },
      });
    }
  }
  return row;
}

export async function releaseLegalHoldCore(opts: {
  holdId: string;
  organisationId: string;
  actorId: string;
  releaseReason: string;
}): Promise<EvidenceLegalHold> {
  const releaseReason = opts.releaseReason.trim();
  if (releaseReason.length < 3) {
    throw new LegalHoldError("A reason is required to release a legal hold", 400);
  }
  const [existing] = await db
    .select()
    .from(evidenceLegalHolds)
    .where(
      and(
        eq(evidenceLegalHolds.id, opts.holdId),
        eq(evidenceLegalHolds.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new LegalHoldError("Legal hold not found", 404);
  if (existing.releasedAt) {
    throw new LegalHoldError("This legal hold has already been released", 409);
  }
  const [updated] = await db
    .update(evidenceLegalHolds)
    .set({
      releasedBy: opts.actorId,
      releasedAt: new Date(),
      releaseReason,
    })
    .where(eq(evidenceLegalHolds.id, opts.holdId))
    .returning();
  if (!updated) throw new LegalHoldError("Legal hold not found", 404);

  if (existing.evidenceId) {
    await recordCustodyEvent({
      evidenceId: existing.evidenceId,
      organisationId: opts.organisationId,
      actorId: opts.actorId,
      eventType: "legal_hold_released",
      reason: releaseReason,
      payload: { hold_id: existing.id },
    });
  } else if (existing.caseId) {
    const caseEvidence = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(
        and(
          eq(attachments.caseId, existing.caseId),
          eq(attachments.organisationId, opts.organisationId),
        ),
      );
    for (const item of caseEvidence) {
      await recordCustodyEvent({
        evidenceId: item.id,
        organisationId: opts.organisationId,
        actorId: opts.actorId,
        eventType: "legal_hold_released",
        reason: releaseReason,
        payload: { hold_id: existing.id, case_id: existing.caseId },
      });
    }
  }
  return updated;
}

/** Case-scoped holds plus holds on any evidence item that belongs to the case. */
export async function listLegalHoldsForCase(
  caseId: string,
  organisationId: string,
): Promise<EvidenceLegalHold[]> {
  return db
    .select({
      id: evidenceLegalHolds.id,
      organisationId: evidenceLegalHolds.organisationId,
      caseId: evidenceLegalHolds.caseId,
      evidenceId: evidenceLegalHolds.evidenceId,
      reason: evidenceLegalHolds.reason,
      appliedBy: evidenceLegalHolds.appliedBy,
      appliedAt: evidenceLegalHolds.appliedAt,
      releasedBy: evidenceLegalHolds.releasedBy,
      releasedAt: evidenceLegalHolds.releasedAt,
      releaseReason: evidenceLegalHolds.releaseReason,
    })
    .from(evidenceLegalHolds)
    .leftJoin(attachments, eq(attachments.id, evidenceLegalHolds.evidenceId))
    .where(
      and(
        eq(evidenceLegalHolds.organisationId, organisationId),
        or(eq(evidenceLegalHolds.caseId, caseId), eq(attachments.caseId, caseId)),
      ),
    );
}
