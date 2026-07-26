import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { cases, slaPolicies, users } from "@/db/schema";
import {
  evaluateSla,
  type SlaGate,
  type SlaStateRecord,
} from "@/lib/sla";
import { writeTimelineEvent } from "@/lib/timeline";
import { sendEmail } from "@/lib/email";
import { queueMobilePushForUsers } from "@/lib/mobile-push";

const GATE_LABELS: Record<SlaGate, string> = {
  acknowledge: "acknowledge",
  contain: "contain",
  resolve: "resolve",
};

export async function runSlaChecks(): Promise<{
  scanned: number;
  breaches: number;
  warnings: number;
}> {
  const openCases = await db
    .select()
    .from(cases)
    .where(ne(cases.status, "closed"));

  if (openCases.length === 0) {
    return { scanned: 0, breaches: 0, warnings: 0 };
  }

  const policies = await db.select().from(slaPolicies);
  const policyBySeverity = new Map<string, typeof policies>();
  for (const policy of policies) {
    const key = `${policy.organisationId}:${policy.severity}`;
    const list = policyBySeverity.get(key) ?? [];
    list.push(policy);
    policyBySeverity.set(key, list);
  }

  const assigneeIds = openCases
    .map((incidentCase) => incidentCase.assigneeId)
    .filter((value): value is string => Boolean(value));
  const assignees =
    assigneeIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, assigneeIds))
      : [];
  const assigneeById = new Map(assignees.map((assignee) => [assignee.id, assignee]));

  let breaches = 0;
  let warnings = 0;

  for (const incidentCase of openCases) {
    const matchingPolicies = policyBySeverity.get(
      `${incidentCase.organisationId}:${incidentCase.severity}`,
    );
    if (!matchingPolicies?.length) continue;
    const evaluation = evaluateSla(incidentCase, matchingPolicies[0]);
    const state = ((incidentCase.slaState as SlaStateRecord) ?? {}) as SlaStateRecord;
    const nowIso = new Date().toISOString();
    let patched = false;

    for (const target of evaluation.targets) {
      if (target.achievedAt) continue;
      if (target.isBreached && !state.breached?.[target.gate]) {
        state.breached = { ...(state.breached ?? {}), [target.gate]: nowIso };
        patched = true;
        breaches++;
        await writeTimelineEvent({
          caseId: incidentCase.id,
          actorId: null,
          eventType: "sla_breach",
          payload: {
            gate: target.gate,
            deadline: target.deadline.toISOString(),
            minutes_over: target.minutesOver,
            severity: incidentCase.severity,
          },
        });
        const assignee = incidentCase.assigneeId
          ? assigneeById.get(incidentCase.assigneeId)
          : null;
        if (assignee) {
          await sendEmail({
            to: assignee.email,
            subject: `[Kelpie] SLA breach ${GATE_LABELS[target.gate]} on ${incidentCase.caseNumber}`,
            text:
              `Case ${incidentCase.caseNumber} — ${incidentCase.title}\n` +
              `Severity: ${incidentCase.severity}\n` +
              `Gate: ${target.gate}\n` +
              `Deadline: ${target.deadline.toISOString()}\n` +
              `Minutes over: ${target.minutesOver}\n` +
              `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${incidentCase.id}\n`,
          });
          await queueMobilePushForUsers(
            incidentCase.organisationId,
            [assignee.id],
            {
              event: "sla_breach",
              sourceId: `${incidentCase.id}:${target.gate}:${target.deadline.toISOString()}`,
              title: "Kelpie SLA breach",
              body: `${incidentCase.caseNumber} breached its ${GATE_LABELS[target.gate]} target.`,
              destinationType: "case",
              destinationId: incidentCase.id,
            },
          );
        }
      } else if (
        !target.isBreached &&
        target.isWarning &&
        !state.warned?.[target.gate]
      ) {
        state.warned = { ...(state.warned ?? {}), [target.gate]: nowIso };
        patched = true;
        warnings++;
        await writeTimelineEvent({
          caseId: incidentCase.id,
          actorId: null,
          eventType: "custom",
          payload: {
            kind: "sla_warning",
            gate: target.gate,
            minutes_until: target.minutesUntil,
            deadline: target.deadline.toISOString(),
          },
        });
      }
    }

    if (patched) {
      await db
        .update(cases)
        .set({ slaState: state })
        .where(
          and(
            eq(cases.id, incidentCase.id),
            eq(cases.organisationId, incidentCase.organisationId),
          ),
        );
    }
  }

  return { scanned: openCases.length, breaches, warnings };
}
