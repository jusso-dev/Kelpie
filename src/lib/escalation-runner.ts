/**
 * Escalation policy sweep, run by the "escalation-check" background job
 * (see `src/lib/jobs/handlers.ts`).
 *
 * SECURITY INVARIANT (do not weaken): this file executes escalation policy
 * actions, and it must NEVER import anything from `src/lib/response-actions/*`
 * (the SOAR / destructive response-action subsystem: Cloudflare block IP,
 * Entra disable user, CrowdStrike isolate host, etc). An escalation policy
 * can only `notify`, `reassign`, or `raise_severity` — see the action
 * handlers below, each of which calls a narrow, non-destructive core
 * function (`sendEmail`/`queueMobilePushForUsers`, `assignCaseAnalystCore`,
 * `patchCaseCore`). There is no code path here that reaches a destructive
 * action, by construction, not merely by runtime check.
 */

import { and, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cases,
  escalationPolicies,
  escalationRuns,
  timelineEvents,
  users,
  type EscalationPolicy,
} from "@/db/schema";
import { CASE_ENUMS, patchCaseCore } from "@/lib/cases-core";
import { assignCaseAnalystCore } from "@/lib/case-ownership-core";
import { notifyWatchers } from "@/lib/case-notifications";
import type { EscalationAction, NotifyAction, ReassignAction } from "@/lib/escalation-core";
import { sendEmail } from "@/lib/email";
import { queueMobilePushForUsers } from "@/lib/mobile-push";
import { writeTimelineEvent } from "@/lib/timeline";
import { newId } from "@/lib/utils";

type CaseRow = typeof cases.$inferSelect;

const SEVERITY_ORDER = CASE_ENUMS.severity;
const DEFAULT_COOLDOWN_MINUTES = 60;

/**
 * `notify` reaches the case's current assignee directly (email/push per the
 * action's `channel`), and separately fans out to case watchers via
 * `notifyWatchers` (event "escalation") from `src/lib/case-notifications.ts`.
 * `notifyWatchers` is fail-soft by construction (it swallows and logs every
 * failure mode internally), so it is safe to call unconditionally here
 * without its own try/catch — it can never throw and therefore can never
 * turn an otherwise-successful notify action into a "failed" run.
 */

type ActionResult = { outcome: "applied" | "skipped" | "failed"; detail: Record<string, unknown> };

export async function runEscalationChecks(): Promise<{
  scanned: number;
  triggered: number;
  skipped: number;
}> {
  const policies = await db
    .select()
    .from(escalationPolicies)
    .where(
      and(
        eq(escalationPolicies.isActive, true),
        isNull(escalationPolicies.disabledAt),
      ),
    );
  if (policies.length === 0) return { scanned: 0, triggered: 0, skipped: 0 };

  const openCases = await db.select().from(cases).where(ne(cases.status, "closed"));
  if (openCases.length === 0) return { scanned: 0, triggered: 0, skipped: 0 };

  const casesByOrg = new Map<string, CaseRow[]>();
  for (const c of openCases) {
    const list = casesByOrg.get(c.organisationId) ?? [];
    list.push(c);
    casesByOrg.set(c.organisationId, list);
  }

  let triggered = 0;
  let skipped = 0;
  const nowMs = Date.now();

  for (const policy of policies) {
    const orgCases = casesByOrg.get(policy.organisationId);
    if (!orgCases || orgCases.length === 0) continue;

    let matched: CaseRow[] = [];
    try {
      matched = await matchCasesForPolicy(policy, orgCases, nowMs);
    } catch (err) {
      console.error(
        `[escalation-runner] failed evaluating policy ${policy.id}`,
        err,
      );
      continue;
    }

    for (const incidentCase of matched) {
      try {
        const applied = await applyPolicyToCase(policy, incidentCase);
        if (applied) triggered++;
        else skipped++;
      } catch (err) {
        console.error(
          `[escalation-runner] failed applying policy ${policy.id} to case ${incidentCase.id}`,
          err,
        );
      }
    }
  }

  return { scanned: openCases.length, triggered, skipped };
}

async function matchCasesForPolicy(
  policy: EscalationPolicy,
  orgCases: CaseRow[],
  nowMs: number,
): Promise<CaseRow[]> {
  const config = (policy.triggerConfig as Record<string, unknown>) ?? {};

  if (policy.triggerType === "age_minutes") {
    const ageMinutes = Number(config.ageMinutes);
    if (!Number.isFinite(ageMinutes) || ageMinutes <= 0) return [];
    const severities = Array.isArray(config.severities)
      ? (config.severities as string[])
      : null;
    const cutoffMs = nowMs - ageMinutes * 60_000;
    return orgCases.filter((c) => {
      if (c.acknowledgedAt) return false;
      if (severities && severities.length > 0 && !severities.includes(c.severity)) {
        return false;
      }
      return c.openedAt.getTime() <= cutoffMs;
    });
  }

  if (policy.triggerType === "sla_warning" || policy.triggerType === "sla_breached") {
    const bucket = policy.triggerType === "sla_warning" ? "warned" : "breached";
    const gate = typeof config.gate === "string" ? config.gate : null;
    return orgCases.filter((c) => {
      const state = (c.slaState as Record<string, Record<string, string>>) ?? {};
      const gates = state[bucket] ?? {};
      if (gate) return Boolean(gates[gate]);
      return Object.keys(gates).length > 0;
    });
  }

  if (policy.triggerType === "stale_status") {
    const status = typeof config.status === "string" ? config.status : null;
    const staleAfterMinutes = Number(config.staleAfterMinutes);
    if (!status || !Number.isFinite(staleAfterMinutes) || staleAfterMinutes <= 0) {
      return [];
    }
    const candidates = orgCases.filter((c) => c.status === status);
    if (candidates.length === 0) return [];
    const candidateIds = candidates.map((c) => c.id);
    // "no timeline_events row for this case since now() - staleAfterMinutes",
    // evaluated with a correlated NOT EXISTS subquery per candidate case, in
    // the same spirit as the `slaRisk` correlated subquery on the cases list
    // page.
    const rows = await db
      .select({
        id: cases.id,
        stale: sql<boolean>`NOT EXISTS (
          SELECT 1 FROM ${timelineEvents}
          WHERE ${timelineEvents.caseId} = ${cases.id}
            AND ${timelineEvents.occurredAt} >= now() - interval '1 minute' * ${staleAfterMinutes}
        )`,
      })
      .from(cases)
      .where(inArray(cases.id, candidateIds));
    const staleIds = new Set(rows.filter((r) => r.stale).map((r) => r.id));
    return candidates.filter((c) => staleIds.has(c.id));
  }

  return [];
}

/** Returns true if the policy's actions were applied (a run was inserted), false if skipped due to cooldown. */
async function applyPolicyToCase(
  policy: EscalationPolicy,
  incidentCase: CaseRow,
): Promise<boolean> {
  const config = (policy.triggerConfig as Record<string, unknown>) ?? {};
  const configuredCooldown = Number(config.cooldownMinutes);
  const cooldownMinutes =
    Number.isFinite(configuredCooldown) && configuredCooldown > 0
      ? configuredCooldown
      : DEFAULT_COOLDOWN_MINUTES;
  const cooldownSince = new Date(Date.now() - cooldownMinutes * 60_000);

  const [recent] = await db
    .select({ id: escalationRuns.id })
    .from(escalationRuns)
    .where(
      and(
        eq(escalationRuns.policyId, policy.id),
        eq(escalationRuns.caseId, incidentCase.id),
        eq(escalationRuns.policyVersion, policy.version),
        gte(escalationRuns.triggeredAt, cooldownSince),
      ),
    )
    .limit(1);
  if (recent) return false;

  const actions = Array.isArray(policy.actions)
    ? (policy.actions as EscalationAction[])
    : [];

  for (const action of actions) {
    const result = await applyAction(policy, incidentCase, action);
    await db.insert(escalationRuns).values({
      id: newId("escrun"),
      policyId: policy.id,
      policyVersion: policy.version,
      caseId: incidentCase.id,
      organisationId: policy.organisationId,
      actionType: action.type,
      outcome: result.outcome,
      detail: result.detail,
    });
  }

  await writeTimelineEvent({
    caseId: incidentCase.id,
    actorId: null,
    eventType: "escalation_triggered",
    payload: {
      policy_id: policy.id,
      policy_name: policy.name,
      policy_version: policy.version,
      trigger_type: policy.triggerType,
      actions: actions.map((a) => a.type),
    },
  });

  return true;
}

async function applyAction(
  policy: EscalationPolicy,
  incidentCase: CaseRow,
  action: EscalationAction,
): Promise<ActionResult> {
  try {
    if (action.type === "notify") {
      return await applyNotifyAction(policy, incidentCase, action);
    }
    if (action.type === "reassign") {
      return await applyReassignAction(policy, incidentCase, action);
    }
    if (action.type === "raise_severity") {
      return await applyRaiseSeverityAction(policy, incidentCase);
    }
    return { outcome: "skipped", detail: { reason: "unknown_action_type" } };
  } catch (err) {
    return { outcome: "failed", detail: { error: (err as Error).message } };
  }
}

async function applyNotifyAction(
  policy: EscalationPolicy,
  incidentCase: CaseRow,
  action: NotifyAction,
): Promise<ActionResult> {
  if (!incidentCase.assigneeId) {
    return { outcome: "skipped", detail: { reason: "no_assignee" } };
  }
  const [assignee] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, incidentCase.assigneeId))
    .limit(1);
  if (!assignee) {
    return { outcome: "skipped", detail: { reason: "assignee_not_found" } };
  }

  const channel = action.channel ?? "both";
  if (channel === "email" || channel === "both") {
    await sendEmail({
      to: assignee.email,
      subject: `[Kelpie] Escalation: ${policy.name} on ${incidentCase.caseNumber}`,
      text:
        `Case ${incidentCase.caseNumber} — ${incidentCase.title}\n` +
        `Severity: ${incidentCase.severity}\n` +
        `Escalation policy: ${policy.name} (${policy.triggerType})\n` +
        `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${incidentCase.id}\n`,
    });
  }
  if (channel === "push" || channel === "both") {
    await queueMobilePushForUsers(incidentCase.organisationId, [assignee.id], {
      event: "escalation_action",
      sourceId: `${incidentCase.id}:${policy.id}:${policy.version}`,
      title: "Kelpie escalation",
      body: `${incidentCase.caseNumber} escalated by policy "${policy.name}".`,
      destinationType: "case",
      destinationId: incidentCase.id,
    });
  }

  const watcherResult = await notifyWatchers({
    organisationId: incidentCase.organisationId,
    caseId: incidentCase.id,
    event: "escalation",
    excludeUserId: assignee.id,
    subject: `[Kelpie] Escalation: ${policy.name} on ${incidentCase.caseNumber}`,
    body: `${incidentCase.caseNumber} — ${incidentCase.title} escalated by policy "${policy.name}".`,
  });

  return {
    outcome: "applied",
    detail: { assigneeId: assignee.id, channel, watchersNotified: watcherResult.notified },
  };
}

async function applyReassignAction(
  policy: EscalationPolicy,
  incidentCase: CaseRow,
  action: ReassignAction,
): Promise<ActionResult> {
  if (incidentCase.assigneeId === action.assigneeId) {
    return {
      outcome: "skipped",
      detail: { reason: "already_assigned", assigneeId: action.assigneeId },
    };
  }
  await assignCaseAnalystCore(
    policy.organisationId,
    null,
    incidentCase.id,
    action.assigneeId,
  );
  return { outcome: "applied", detail: { assigneeId: action.assigneeId } };
}

async function applyRaiseSeverityAction(
  policy: EscalationPolicy,
  incidentCase: CaseRow,
): Promise<ActionResult> {
  const currentIndex = SEVERITY_ORDER.indexOf(incidentCase.severity);
  if (currentIndex === -1 || currentIndex === SEVERITY_ORDER.length - 1) {
    return {
      outcome: "skipped",
      detail: { reason: "already_max_severity", severity: incidentCase.severity },
    };
  }
  const next = SEVERITY_ORDER[currentIndex + 1];
  await patchCaseCore(policy.organisationId, null, incidentCase.id, {
    severity: next,
  });
  return { outcome: "applied", detail: { from: incidentCase.severity, to: next } };
}
