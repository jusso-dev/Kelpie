import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { alerts } from "@/db/schema";
import { newId } from "@/lib/utils";
import { fireWebhook } from "@/lib/webhooks";
import { queueCriticalAlertPush } from "@/lib/mobile-push";

type AlertSeverity = "low" | "medium" | "high" | "critical";

export type IngestAlertInput = {
  source: string;
  externalRef?: string | null;
  title: string;
  description?: string | null;
  severity?: AlertSeverity;
  observables?: Array<{ type: string; value: string }>;
  rawPayload?: Record<string, unknown>;
};

export type IngestAlertResult = {
  alert: typeof alerts.$inferSelect;
  created: boolean;
};

/**
 * Insert an alert once per upstream identity. The database constraint is the
 * concurrency boundary; a replay returns the existing row and emits no second
 * webhook event.
 */
export async function ingestAlert(
  organisationId: string,
  input: IngestAlertInput,
): Promise<IngestAlertResult> {
  const externalRef = input.externalRef?.trim() || null;
  const [created] = await db
    .insert(alerts)
    .values({
      id: newId("alert"),
      organisationId,
      source: input.source,
      externalRef,
      title: input.title,
      description: input.description ?? null,
      severity: input.severity ?? "medium",
      observables: input.observables ?? [],
      rawPayload: input.rawPayload ?? {},
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    await fireWebhook(organisationId, "alert.created", {
      alert_id: created.id,
      title: created.title,
      severity: created.severity,
      source: created.source,
    });
    if (created.severity === "critical") {
      await queueCriticalAlertPush({ organisationId, alertId: created.id });
    }
    return { alert: created, created: true };
  }

  if (!externalRef) {
    throw new Error("Alert insert failed without an upstream identity conflict");
  }

  const [existing] = await db
    .select()
    .from(alerts)
    .where(
      and(
        eq(alerts.organisationId, organisationId),
        eq(alerts.source, input.source),
        eq(alerts.externalRef, externalRef),
      ),
    )
    .limit(1);

  if (!existing) {
    throw new Error("Alert identity conflict could not be resolved");
  }
  return { alert: existing, created: false };
}
