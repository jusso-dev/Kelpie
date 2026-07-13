import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { alerts, cases, observables } from "@/db/schema";
import { nextCaseNumber } from "@/lib/case-number";
import { enrichObservable } from "@/lib/enrichment";
import { writeTimelineEvent } from "@/lib/timeline";
import { newId } from "@/lib/utils";

export async function acknowledgeAlertsCore(
  organisationId: string,
  actorId: string | null,
  alertIds: string[],
): Promise<void> {
  if (alertIds.length === 0) return;
  await db
    .update(alerts)
    .set({ status: "triaged", triagedBy: actorId, triagedAt: sql`now()` })
    .where(
      and(
        eq(alerts.organisationId, organisationId),
        eq(alerts.status, "new"),
        inArray(alerts.id, alertIds),
      ),
    );
}

export async function dismissAlertsCore(
  organisationId: string,
  actorId: string | null,
  alertIds: string[],
): Promise<void> {
  if (alertIds.length === 0) return;
  await db
    .update(alerts)
    .set({ status: "dismissed", triagedBy: actorId, triagedAt: sql`now()` })
    .where(
      and(
        eq(alerts.organisationId, organisationId),
        inArray(alerts.status, ["new", "triaged"]),
        inArray(alerts.id, alertIds),
      ),
    );
}

export async function promoteAlertToCaseCore(
  organisationId: string,
  actorId: string | null,
  alertId: string,
): Promise<{ caseId: string }> {
  const [alert] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.organisationId, organisationId)))
    .limit(1);
  if (!alert) throw new Error("Alert not found");
  if (alert.status === "promoted" && alert.promotedCaseId) {
    return { caseId: alert.promotedCaseId };
  }
  if (alert.status === "dismissed") throw new Error("Dismissed alert cannot be promoted");

  const caseId = newId("case");
  const caseNumber = await nextCaseNumber(organisationId);
  await db.insert(cases).values({
    id: caseId,
    organisationId,
    caseNumber,
    title: alert.title,
    summary: alert.description ?? "",
    severity: alert.severity,
    status: "open",
    reporterId: actorId,
    assigneeId: actorId,
    classification: "other",
    sourceAlertId: alert.id,
  });
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "case_created",
    payload: { from_alert: alert.id, alert_source: alert.source },
  });

  const incoming = Array.isArray(alert.observables)
    ? (alert.observables as Array<{ type?: string; value?: string }>)
    : [];
  const allowed = [
    "ip",
    "domain",
    "url",
    "file_hash",
    "email",
    "hostname",
    "username",
    "registry_key",
    "other",
  ] as const;
  const toEnrich: Array<{ id: string; type: string; value: string }> = [];
  for (const incomingObservable of incoming) {
    if (!incomingObservable.type || !incomingObservable.value) continue;
    const type = (allowed as readonly string[]).includes(incomingObservable.type)
      ? (incomingObservable.type as (typeof allowed)[number])
      : "other";
    const id = newId("obs");
    await db.insert(observables).values({
      id,
      caseId,
      type,
      value: incomingObservable.value,
      createdBy: actorId,
    });
    await writeTimelineEvent({
      caseId,
      actorId,
      eventType: "observable_added",
      payload: {
        observable_id: id,
        type,
        value: incomingObservable.value,
        from_alert: alert.id,
      },
    });
    toEnrich.push({ id, type, value: incomingObservable.value });
  }
  await db
    .update(alerts)
    .set({
      status: "promoted",
      triagedBy: actorId,
      triagedAt: sql`now()`,
      promotedCaseId: caseId,
    })
    .where(eq(alerts.id, alert.id));
  void Promise.allSettled(
    toEnrich.map((observable) =>
      enrichObservable(observable.id, observable.type, observable.value),
    ),
  );
  return { caseId };
}
