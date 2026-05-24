"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { alerts, cases, observables } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireUser, requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { nextCaseNumber } from "@/lib/case-number";
import { writeTimelineEvent } from "@/lib/timeline";
import { enrichObservable } from "@/lib/enrichment";

export async function dismissAlerts(alertIds: string[]) {
  const user = await requireRole(["admin", "analyst"]);
  if (alertIds.length === 0) return;
  await db
    .update(alerts)
    .set({ status: "dismissed", triagedBy: user.id, triagedAt: sql`now()` })
    .where(
      and(
        eq(alerts.organisationId, user.organisationId),
        inArray(alerts.id, alertIds),
      ),
    );
  revalidatePath("/alerts");
}

export async function promoteAlertToCase(alertId: string) {
  const user = await requireRole(["admin", "analyst"]);
  const [alert] = await db
    .select()
    .from(alerts)
    .where(
      and(eq(alerts.id, alertId), eq(alerts.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!alert) throw new Error("Alert not found");
  if (alert.status === "promoted" && alert.promotedCaseId) {
    return { caseId: alert.promotedCaseId };
  }

  const caseId = newId("case");
  const caseNumber = await nextCaseNumber(user.organisationId);

  await db.insert(cases).values({
    id: caseId,
    organisationId: user.organisationId,
    caseNumber,
    title: alert.title,
    summary: alert.description ?? "",
    severity: alert.severity,
    status: "open",
    reporterId: user.id,
    assigneeId: user.id,
    classification: "other",
    sourceAlertId: alert.id,
  });

  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "case_created",
    payload: { from_alert: alert.id, alert_source: alert.source },
  });

  // Carry across observables from the alert payload.
  const incoming = Array.isArray(alert.observables)
    ? (alert.observables as Array<{ type?: string; value?: string }>)
    : [];
  const toEnrich: Array<{ id: string; type: string; value: string }> = [];
  for (const obs of incoming) {
    if (!obs.type || !obs.value) continue;
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
    const type = (allowed as readonly string[]).includes(obs.type)
      ? (obs.type as (typeof allowed)[number])
      : "other";
    const id = newId("obs");
    await db.insert(observables).values({
      id,
      caseId,
      type,
      value: obs.value,
      createdBy: user.id,
    });
    await writeTimelineEvent({
      caseId,
      actorId: user.id,
      eventType: "observable_added",
      payload: { observable_id: id, type, value: obs.value, from_alert: alert.id },
    });
    toEnrich.push({ id, type, value: obs.value });
  }

  await db
    .update(alerts)
    .set({
      status: "promoted",
      triagedBy: user.id,
      triagedAt: sql`now()`,
      promotedCaseId: caseId,
    })
    .where(eq(alerts.id, alert.id));

  // Fire-and-forget enrichment; intentionally not awaited so the navigation
  // is snappy. Errors are logged inside enrichObservable.
  void Promise.allSettled(
    toEnrich.map((o) => enrichObservable(o.id, o.type, o.value)),
  );

  revalidatePath("/alerts");
  revalidatePath("/cases");
  return { caseId };
}
