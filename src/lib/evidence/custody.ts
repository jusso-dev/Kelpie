import { db } from "@/db";
import { evidenceCustodyEvents } from "@/db/schema";
import { newId } from "@/lib/utils";

/**
 * Every action this module's callers can take against an evidence row.
 * Rows in `evidence_custody_events` are append-only: never updated or
 * deleted by application code, including when evidence itself is deleted.
 */
export type CustodyEventType =
  | "uploaded"
  | "scan_completed"
  | "quarantined"
  | "scan_failed"
  | "override_granted"
  | "downloaded"
  | "renamed"
  | "deleted"
  | "hash_verified"
  | "hash_mismatch"
  | "legal_hold_applied"
  | "legal_hold_released"
  | "derived_copy_created"
  | "label_added"
  | "label_removed"
  | "relevance_changed"
  | "notes_updated"
  | "acquisition_updated"
  | "collection_created"
  | "collection_added"
  | "collection_removed";

export async function recordCustodyEvent(opts: {
  evidenceId: string;
  organisationId: string;
  actorId: string | null;
  eventType: CustodyEventType;
  reason?: string | null;
  payload?: Record<string, unknown>;
}) {
  await db.insert(evidenceCustodyEvents).values({
    id: newId("cev"),
    evidenceId: opts.evidenceId,
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    eventType: opts.eventType,
    reason: opts.reason ?? null,
    payload: opts.payload ?? {},
  });
}
