/**
 * Health tracking for push-delivered case sources (Tawny and friends).
 *
 * Every `POST /api/v1/cases` call that carries a `sourceSystem` rolls up into
 * one row per (organisation, source system): counts of deliveries, created vs
 * duplicate outcomes, and the most recent error. This is purely observability
 * — nothing here participates in idempotency or authorisation — so a failure
 * in this module must never be allowed to fail the case write that triggered
 * it. Every exported write function therefore swallows its own errors.
 */

import { db } from "@/db";
import { inboundSourceStatus, type InboundSourceStatus } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { KNOWN_PUSH_SOURCE_SYSTEMS } from "@/lib/case-source-identity";

const MAX_ERROR_MESSAGE_LENGTH = 300;

/**
 * Strips anything that looks like a credential before an error message is
 * persisted: Kelpie API tokens (`klp_...`) and bearer-auth headers echoed
 * back from a misconfigured caller. Never pass a request body through this;
 * it only sanitises free-text messages we generate ourselves.
 */
export function redactStatusMessage(message: string): string {
  const redacted = message
    .replace(/\bklp_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/bearer\s+\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length > MAX_ERROR_MESSAGE_LENGTH
    ? redacted.slice(0, MAX_ERROR_MESSAGE_LENGTH)
    : redacted;
}

/** Records a successful (created or deduplicated) inbound case delivery. */
export async function recordInboundSourceDelivery(opts: {
  organisationId: string;
  sourceSystem: string;
  outcome: "created" | "duplicate";
}): Promise<void> {
  try {
    const now = new Date();
    await db
      .insert(inboundSourceStatus)
      .values({
        id: newId("inbound_source_status"),
        organisationId: opts.organisationId,
        sourceSystem: opts.sourceSystem,
        lastDeliveryAt: now,
        lastCaseCreatedAt: opts.outcome === "created" ? now : null,
        deliveryCount: 1,
        createdCaseCount: opts.outcome === "created" ? 1 : 0,
        duplicateCount: opts.outcome === "duplicate" ? 1 : 0,
      })
      .onConflictDoUpdate({
        target: [inboundSourceStatus.organisationId, inboundSourceStatus.sourceSystem],
        set: {
          lastDeliveryAt: now,
          updatedAt: now,
          deliveryCount: sql`${inboundSourceStatus.deliveryCount} + 1`,
          ...(opts.outcome === "created"
            ? {
                lastCaseCreatedAt: now,
                createdCaseCount: sql`${inboundSourceStatus.createdCaseCount} + 1`,
              }
            : { duplicateCount: sql`${inboundSourceStatus.duplicateCount} + 1` }),
        },
      });
  } catch {
    // Delivery telemetry is best-effort; the case write it describes has
    // already succeeded and must not be undone by a counter failing to update.
  }
}

/** Records a failed inbound delivery attempt for a known source system. */
export async function recordInboundSourceError(opts: {
  organisationId: string;
  sourceSystem: string;
  status: number;
  message: string;
}): Promise<void> {
  try {
    // The error path is reachable with a rejected payload, so the source system
    // it names was never validated against anything that exists. Only track
    // producers Kelpie ships support for, or ones that have already delivered
    // successfully — otherwise a token could mint a status row per made-up
    // slug simply by sending malformed requests.
    if (!KNOWN_PUSH_SOURCE_SYSTEMS.includes(opts.sourceSystem)) {
      const existing = await getInboundSourceStatus(
        opts.organisationId,
        opts.sourceSystem,
      );
      if (!existing) return;
    }
    const now = new Date();
    const message = redactStatusMessage(opts.message);
    await db
      .insert(inboundSourceStatus)
      .values({
        id: newId("inbound_source_status"),
        organisationId: opts.organisationId,
        sourceSystem: opts.sourceSystem,
        lastErrorAt: now,
        lastErrorStatus: opts.status,
        lastErrorMessage: message,
        errorCount: 1,
      })
      .onConflictDoUpdate({
        target: [inboundSourceStatus.organisationId, inboundSourceStatus.sourceSystem],
        set: {
          lastErrorAt: now,
          lastErrorStatus: opts.status,
          lastErrorMessage: message,
          updatedAt: now,
          errorCount: sql`${inboundSourceStatus.errorCount} + 1`,
        },
      });
  } catch {
    // Error telemetry is best-effort; a failure to record it must not mask
    // or replace the original error response already sent to the caller.
  }
}

/** Current delivery health for one (organisation, source system) pair. */
export async function getInboundSourceStatus(
  organisationId: string,
  sourceSystem: string,
): Promise<InboundSourceStatus | null> {
  const [row] = await db
    .select()
    .from(inboundSourceStatus)
    .where(
      and(
        eq(inboundSourceStatus.organisationId, organisationId),
        eq(inboundSourceStatus.sourceSystem, sourceSystem),
      ),
    )
    .limit(1);
  return row ?? null;
}
