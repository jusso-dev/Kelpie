import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  automationRules,
  automationRuns,
  cases,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { checkKillSwitch, MUSTER_AUTOMATION_PROVIDER } from "@/lib/run-console/kill-switch";
import { isUniqueViolation } from "@/lib/db-errors";
import { matchesAutomationConditions } from "./conditions";
import { buildMusterTriggerEnvelope } from "./envelope";
import {
  AUTOMATION_CONDITION_FIELDS,
  AUTOMATION_TRIGGERS,
  type AutomationCaseSnapshot,
  type AutomationCondition,
  type AutomationTrigger,
} from "./types";

const TIMELINE_TRIGGER: Record<string, AutomationTrigger | undefined> = {
  case_created: "case.created",
  status_change: "case.status_changed",
};

function parseConditions(value: unknown): AutomationCondition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((condition): condition is AutomationCondition => {
    if (!condition || typeof condition !== "object") return false;
    const row = condition as Record<string, unknown>;
    return (
      typeof row.field === "string" &&
      AUTOMATION_CONDITION_FIELDS.includes(
        row.field as (typeof AUTOMATION_CONDITION_FIELDS)[number],
      ) &&
      (row.operator === "equals" ||
        row.operator === "not_equals" ||
        row.operator === "contains") &&
      typeof row.value === "string"
    );
  });
}

function caseSnapshot(row: typeof cases.$inferSelect): AutomationCaseSnapshot {
  return {
    id: row.id,
    caseNumber: row.caseNumber,
    version: row.version,
    status: row.status,
    severity: row.severity,
    classification: row.classification,
    tlp: row.tlp,
    pap: row.pap,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    sourceSystem: row.sourceSystem,
  };
}

export function isAutomationTrigger(value: string): value is AutomationTrigger {
  return AUTOMATION_TRIGGERS.includes(value as AutomationTrigger);
}

export async function queueAutomationRunsForTimelineEvent(input: {
  timelineEventId: string;
  timelineEventType: string;
  caseId: string;
  occurredAt: Date;
}): Promise<number> {
  const trigger = TIMELINE_TRIGGER[input.timelineEventType];
  if (!trigger) return 0;
  const [caseRow] = await db
    .select()
    .from(cases)
    .where(eq(cases.id, input.caseId))
    .limit(1);
  if (!caseRow) return 0;
  const rules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.organisationId, caseRow.organisationId),
        eq(automationRules.triggerEvent, trigger),
        eq(automationRules.isActive, true),
      ),
    );
  const snapshot = caseSnapshot(caseRow);
  let queued = 0;
  for (const rule of rules) {
    if (
      !matchesAutomationConditions(
        snapshot,
        parseConditions(rule.conditions),
      )
    ) {
      continue;
    }
    const traceId = newId("trace");
    const envelope = buildMusterTriggerEnvelope({
      eventId: input.timelineEventId,
      event: trigger,
      occurredAt: input.occurredAt,
      organisationId: caseRow.organisationId,
      traceId,
      targetProfile: rule.targetProfile,
      ruleId: rule.id,
      ruleRevision: rule.revision,
      snapshot,
    });
    const inserted = await db
      .insert(automationRuns)
      .values({
        id: newId("aur"),
        organisationId: caseRow.organisationId,
        ruleId: rule.id,
        caseId: caseRow.id,
        triggerEventId: input.timelineEventId,
        triggerEvent: trigger,
        traceId,
        request: envelope,
      })
      .onConflictDoNothing()
      .returning({ id: automationRuns.id });
    if (inserted.length > 0) queued++;
  }
  return queued;
}

/**
 * Manual retry (issue #67). Only a terminal `failed`/`cancelled` run is
 * retryable, and only into a brand new child row referencing the parent by
 * id: the parent's request/response/lastError is never rewritten. The child
 * reuses the exact same envelope (`request`) the original run built, so a
 * retry can never expand the rule's trigger, conditions, or target profile.
 * The (ruleId, triggerEventId) unique index is scoped to root rows only, so
 * this insert never collides with it; a partial unique index on
 * `parentRunId` instead makes a concurrent double-retry fail cleanly.
 */
export async function retryAutomationRun(
  organisationId: string,
  actorId: string,
  runId: string,
): Promise<{ runId: string }> {
  const [row] = await db
    .select({ run: automationRuns, rule: automationRules })
    .from(automationRuns)
    .innerJoin(automationRules, eq(automationRuns.ruleId, automationRules.id))
    .where(
      and(
        eq(automationRuns.id, runId),
        eq(automationRuns.organisationId, organisationId),
        eq(automationRules.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!row) throw new Error("Automation run not found");
  const prior = row.run;
  if (prior.status !== "failed" && prior.status !== "cancelled") {
    throw new Error("Only a failed or cancelled automation run can be retried");
  }
  if (!row.rule.isActive) {
    throw new Error("Automation rule is disabled and cannot be retried");
  }
  const killSwitch = await checkKillSwitch(organisationId, {
    provider: MUSTER_AUTOMATION_PROVIDER,
    actionId: row.rule.id,
  });
  if (killSwitch.active) {
    throw new Error(`Blocked by the ${killSwitch.scope} kill switch: ${killSwitch.reason}`);
  }

  const rootRunId = prior.rootRunId ?? prior.id;
  const childId = newId("aur");
  try {
    await db.insert(automationRuns).values({
      id: childId,
      organisationId,
      ruleId: prior.ruleId,
      caseId: prior.caseId,
      triggerEventId: prior.triggerEventId,
      triggerEvent: prior.triggerEvent,
      traceId: prior.traceId,
      request: prior.request,
      status: "pending",
      nextAttemptAt: new Date(),
      parentRunId: prior.id,
      rootRunId,
      lineageAttempt: prior.lineageAttempt + 1,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A retry has already been requested for this run");
    }
    throw error;
  }
  await writeTimelineEvent({
    caseId: prior.caseId,
    actorId,
    eventType: "automation_run",
    payload: {
      ruleId: row.rule.id,
      runId: childId,
      targetProfile: row.rule.targetProfile,
      status: "pending",
      retryOf: prior.id,
    },
  });
  return { runId: childId };
}

/**
 * Best-effort cancel. A still-`pending` run (nothing sent yet) is cancelled
 * outright. A `running` run only gets a `cancel_requested` marker: the
 * in-flight delivery already has an outcome by the time it finishes, and
 * this never rewrites that outcome to pretend Muster never received it.
 */
export async function requestAutomationCancel(
  organisationId: string,
  actorId: string,
  runId: string,
): Promise<{ status: string; bestEffort: boolean }> {
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.id, runId), eq(automationRuns.organisationId, organisationId)))
    .limit(1);
  if (!run) throw new Error("Automation run not found");
  if (run.status === "pending") {
    const [cancelled] = await db
      .update(automationRuns)
      .set({
        status: "cancelled",
        lastError: "cancelled by operator",
        cancelRequestedAt: new Date(),
        cancelRequestedBy: actorId,
        completedAt: new Date(),
      })
      .where(and(eq(automationRuns.id, runId), eq(automationRuns.status, "pending")))
      .returning();
    if (!cancelled) throw new Error("Automation run is no longer pending");
    return { status: "cancelled", bestEffort: false };
  }
  if (run.status === "running") {
    await db
      .update(automationRuns)
      .set({ cancelRequestedAt: new Date(), cancelRequestedBy: actorId })
      .where(and(eq(automationRuns.id, runId), eq(automationRuns.status, "running")));
    return { status: "running", bestEffort: true };
  }
  throw new Error("Automation run is already terminal");
}
