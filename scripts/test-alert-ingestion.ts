import assert from "node:assert/strict";
import { and, count, eq } from "drizzle-orm";
import { db } from "../src/db";
import {
  alerts,
  organisations,
  webhookDeliveries,
  webhooks,
} from "../src/db/schema";
import { ingestAlert } from "../src/lib/alerts-core";
import { newId } from "../src/lib/utils";

async function main() {
  const organisationId = newId("org");
  await db.insert(organisations).values({
    id: organisationId,
    name: "Alert ingestion test",
    slug: `alert-ingestion-${organisationId.slice(-8)}`,
  });

  try {
    const webhookId = newId("wh");
    await db.insert(webhooks).values({
      id: webhookId,
      organisationId,
      name: "Alert audit",
      url: "https://example.test/kelpie",
      secret: "test-secret",
      events: ["alert.created"],
      createdBy: null,
    });

    const input = {
      source: "test-siem",
      externalRef: "event-42",
      title: "Repeated upstream event",
      severity: "high" as const,
    };
    const attempts = await Promise.all([
      ingestAlert(organisationId, input),
      ingestAlert(organisationId, input),
      ingestAlert(organisationId, input),
    ]);

    assert.equal(attempts.filter((result) => result.created).length, 1);
    assert.equal(new Set(attempts.map((result) => result.alert.id)).size, 1);

    const [{ alertCount }] = await db
      .select({ alertCount: count() })
      .from(alerts)
      .where(
        and(
          eq(alerts.organisationId, organisationId),
          eq(alerts.source, input.source),
          eq(alerts.externalRef, input.externalRef),
        ),
      );
    assert.equal(Number(alertCount), 1);

    const [{ deliveryCount }] = await db
      .select({ deliveryCount: count() })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.webhookId, webhookId));
    assert.equal(Number(deliveryCount), 1);

    const otherSource = await ingestAlert(organisationId, {
      ...input,
      source: "other-siem",
    });
    assert.equal(otherSource.created, true);
    assert.notEqual(otherSource.alert.id, attempts[0].alert.id);

    const withoutIdentity = await Promise.all([
      ingestAlert(organisationId, {
        source: "manual",
        title: "No upstream identity",
      }),
      ingestAlert(organisationId, {
        source: "manual",
        title: "No upstream identity",
      }),
    ]);
    assert.ok(withoutIdentity.every((result) => result.created));
    assert.notEqual(withoutIdentity[0].alert.id, withoutIdentity[1].alert.id);

    console.log("Alert ingestion is idempotent by organisation, source, and external reference.");
  } finally {
    await db.delete(organisations).where(eq(organisations.id, organisationId));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
