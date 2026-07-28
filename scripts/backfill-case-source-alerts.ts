/**
 * Backfills the normalized investigation model (issue #55) for cases that
 * were created before alerts existed. For every case that already carries
 * `sourceSystem`/`sourceReference` provenance and has no `case_alerts` link
 * yet, this creates (or reuses) an `alert_sources` row for that source, an
 * `alerts` row that preserves the exact source system/reference as
 * `detectionSource`/`externalId`, and links it into the case as the primary
 * alert.
 *
 * Idempotent and safe to re-run: it is keyed off the same
 * `(organisationId, sourceId, tenantId, externalId)` uniqueness the live
 * ingestion path uses, so a second run creates zero new alerts and zero new
 * links — it only picks up cases that still have no alert.
 *
 * Usage: `tsx scripts/backfill-case-source-alerts.ts` (registered as
 * `npm run backfill:alerts`). Requires `DATABASE_URL` to point at the target
 * database; does not touch any case, alert, or link outside that database.
 */
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { db } from "../src/db";
import { caseAlerts, cases } from "../src/db/schema";
import { createOrUpdateAlertFromProviderCore, getOrCreateAlertSourceCore, linkAlertToCaseCore } from "../src/lib/investigations/alerts-core";

async function main() {
  const alreadyLinked = await db
    .select({ caseId: caseAlerts.caseId })
    .from(caseAlerts);
  const linkedIds = alreadyLinked.map((r) => r.caseId);

  const candidates = await db
    .select({
      id: cases.id,
      organisationId: cases.organisationId,
      title: cases.title,
      summary: cases.summary,
      sourceSystem: cases.sourceSystem,
      sourceReference: cases.sourceReference,
      sourceUrl: cases.sourceUrl,
      severity: cases.severity,
      classification: cases.classification,
      openedAt: cases.openedAt,
    })
    .from(cases)
    .where(
      and(
        isNotNull(cases.sourceSystem),
        isNotNull(cases.sourceReference),
        linkedIds.length > 0 ? notInArray(cases.id, linkedIds) : undefined,
      ),
    );

  let created = 0;
  let skipped = 0;
  for (const c of candidates) {
    if (!c.sourceSystem || !c.sourceReference) {
      skipped++;
      continue;
    }
    const source = await getOrCreateAlertSourceCore({
      organisationId: c.organisationId,
      kind: c.sourceSystem,
      name: c.sourceSystem,
    });
    const { alert } = await createOrUpdateAlertFromProviderCore({
      organisationId: c.organisationId,
      sourceId: source.id,
      externalId: c.sourceReference,
      title: c.title,
      description: c.summary,
      detectionSource: c.sourceSystem,
      classification: c.classification,
      severity: c.severity,
      sourceUrl: c.sourceUrl,
      providerCreatedAt: c.openedAt,
    });
    await linkAlertToCaseCore({
      organisationId: c.organisationId,
      actorId: null,
      caseId: c.id,
      alertId: alert.id,
      isPrimary: true,
    });
    created++;
  }

  console.log(
    `Backfill complete: ${created} case(s) linked to a preserved-provenance alert, ${skipped} skipped.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
