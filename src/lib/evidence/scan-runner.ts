import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { readFile } from "@/lib/storage";
import { getConfiguredScanner } from "./clamav-scanner";
import { recordCustodyEvent } from "./custody";
import type { ScanOutcome } from "./scanner";

function statusForVerdict(verdict: ScanOutcome["verdict"]) {
  if (verdict === "clean") return "available" as const;
  if (verdict === "malicious") return "quarantined" as const;
  return "scan_failed" as const;
}

/**
 * Polled by the `scan-evidence` job (same outbox-polling shape as
 * `processPendingDeliveries`/webhooks). Async so uploads never block on
 * ClamAV, and idempotent under concurrent workers: the status-guarded
 * `UPDATE ... WHERE status = 'pending_scan'` means only one worker's write
 * wins per row.
 */
export async function scanPendingEvidence(limit = 10): Promise<{
  scanned: number;
  quarantined: number;
  failed: number;
}> {
  const due = await db
    .select()
    .from(attachments)
    .where(eq(attachments.status, "pending_scan"))
    .orderBy(asc(attachments.uploadedAt))
    .limit(limit);

  let scanned = 0;
  let quarantined = 0;
  let failed = 0;

  for (const row of due) {
    const scanner = getConfiguredScanner();
    let outcome: ScanOutcome;
    try {
      const buffer = await readFile(row.storageKey);
      outcome = await scanner.scan(buffer);
    } catch (error) {
      outcome = {
        verdict: "error",
        engine: scanner.name,
        detail:
          error instanceof Error
            ? error.message
            : "Unable to read stored evidence for scanning",
      };
    }

    const nextStatus = statusForVerdict(outcome.verdict);
    const [updated] = await db
      .update(attachments)
      .set({
        status: nextStatus,
        scannerName: outcome.engine,
        scanVerdict: outcome.verdict,
        scanDetail: outcome.detail ?? null,
        scannedAt: new Date(),
      })
      .where(
        and(eq(attachments.id, row.id), eq(attachments.status, "pending_scan")),
      )
      .returning({ id: attachments.id });
    if (!updated) continue; // a concurrent worker already handled this row

    scanned++;
    if (nextStatus === "quarantined") quarantined++;
    if (nextStatus === "scan_failed") failed++;

    await recordCustodyEvent({
      evidenceId: row.id,
      organisationId: row.organisationId,
      actorId: null,
      eventType:
        nextStatus === "quarantined"
          ? "quarantined"
          : nextStatus === "scan_failed"
            ? "scan_failed"
            : "scan_completed",
      reason:
        outcome.verdict === "malicious"
          ? (outcome.signature ?? "Malware signature matched")
          : null,
      payload: {
        engine: outcome.engine,
        verdict: outcome.verdict,
        detail: outcome.detail ?? null,
        signature: outcome.signature ?? null,
      },
    });
  }

  return { scanned, quarantined, failed };
}
