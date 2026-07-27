import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  automationRules,
  automationRuns,
  cases,
} from "@/db/schema";
import { newId } from "@/lib/utils";
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
