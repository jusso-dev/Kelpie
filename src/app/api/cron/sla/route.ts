import { NextResponse } from "next/server";
import { db } from "@/db";
import { cases, slaPolicies, users } from "@/db/schema";
import { and, eq, ne, inArray } from "drizzle-orm";
import {
  evaluateSla,
  type SlaGate,
  type SlaStateRecord,
} from "@/lib/sla";
import { writeTimelineEvent } from "@/lib/timeline";
import { sendEmail } from "@/lib/email";
import { isAuthorisedCron } from "@/lib/cron";
import { queueMobilePushForUsers } from "@/lib/mobile-push";

const GATE_LABELS: Record<SlaGate, string> = {
  acknowledge: "acknowledge",
  contain: "contain",
  resolve: "resolve",
};

async function runOnce(): Promise<{ scanned: number; breaches: number; warnings: number }> {
  const openCases = await db
    .select()
    .from(cases)
    .where(ne(cases.status, "closed"));

  if (openCases.length === 0) {
    return { scanned: 0, breaches: 0, warnings: 0 };
  }

  const policies = await db.select().from(slaPolicies);
  const policyBySeverity = new Map<string, typeof policies>();
  for (const p of policies) {
    const key = `${p.organisationId}:${p.severity}`;
    const list = policyBySeverity.get(key) ?? [];
    list.push(p);
    policyBySeverity.set(key, list);
  }

  const assigneeIds = openCases
    .map((c) => c.assigneeId)
    .filter((x): x is string => Boolean(x));
  const assignees =
    assigneeIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(inArray(users.id, assigneeIds))
      : [];
  const assigneeById = new Map(assignees.map((u) => [u.id, u]));

  let breaches = 0;
  let warnings = 0;

  for (const c of openCases) {
    const matchingPolicies = policyBySeverity.get(`${c.organisationId}:${c.severity}`);
    if (!matchingPolicies || matchingPolicies.length === 0) continue;
    const policy = matchingPolicies[0];
    const evaluation = evaluateSla(c, policy);
    const state = ((c.slaState as SlaStateRecord) ?? {}) as SlaStateRecord;
    const nowIso = new Date().toISOString();
    let patched = false;

    for (const target of evaluation.targets) {
      if (target.achievedAt) continue;
      if (target.isBreached && !state.breached?.[target.gate]) {
        state.breached = { ...(state.breached ?? {}), [target.gate]: nowIso };
        patched = true;
        breaches++;
        await writeTimelineEvent({
          caseId: c.id,
          actorId: null,
          eventType: "sla_breach",
          payload: {
            gate: target.gate,
            deadline: target.deadline.toISOString(),
            minutes_over: target.minutesOver,
            severity: c.severity,
          },
        });
        const assignee = c.assigneeId ? assigneeById.get(c.assigneeId) : null;
        if (assignee) {
          await sendEmail({
            to: assignee.email,
            subject: `[Kelpie] SLA breach ${GATE_LABELS[target.gate]} on ${c.caseNumber}`,
            text:
              `Case ${c.caseNumber} — ${c.title}\n` +
              `Severity: ${c.severity}\n` +
              `Gate: ${target.gate}\n` +
              `Deadline: ${target.deadline.toISOString()}\n` +
              `Minutes over: ${target.minutesOver}\n` +
              `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${c.id}\n`,
          });
          await queueMobilePushForUsers(c.organisationId, [assignee.id], {
            event: "sla_breach",
            sourceId: `${c.id}:${target.gate}:${target.deadline.toISOString()}`,
            title: "Kelpie SLA breach",
            body: `${c.caseNumber} breached its ${GATE_LABELS[target.gate]} target.`,
            destinationType: "case",
            destinationId: c.id,
          });
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
          caseId: c.id,
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
      await db.update(cases).set({ slaState: state }).where(eq(cases.id, c.id));
    }
  }

  return { scanned: openCases.length, breaches, warnings };
}

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await runOnce();
  return NextResponse.json({ ok: true, ...result });
}

// GET form for ease of testing with curl. Same auth requirement.
export async function GET(req: Request) {
  return POST(req);
}
