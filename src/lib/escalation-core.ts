/**
 * Versioned, safely-disableable escalation policies.
 *
 * A policy can only ever notify, reassign, or raise severity: those are the
 * only actions the schema has columns for (see `escalationPolicies` in
 * src/db/schema.ts), so a destructive response action cannot be expressed
 * here even by a future bug -- there is no field to put it in, and no
 * connection to src/lib/response-actions is made anywhere in this module.
 *
 * `revision` increments on every behavioural edit (`updateEscalationPolicy`),
 * never on an isActive toggle, so disabling and re-enabling a policy does
 * not let it re-fire against cases it already escalated under the same
 * rules. `escalationPolicyRuns` is keyed uniquely on (policyId,
 * policyRevision, caseId), so the periodic runner is idempotent: a case is
 * only ever escalated once per policy revision.
 */
import { db } from "@/db";
import {
  cases,
  caseWatchers,
  escalationPolicies,
  escalationPolicyRuns,
  queues,
  teamMembers,
  users,
  type Case,
  type EscalationPolicy,
} from "@/db/schema";
import type { CaseSeverity } from "./cases-core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";
import { sendEmail } from "./email";
import { queueMobilePushForUsers } from "./mobile-push";
import {
  assignCaseAnalystCore,
  assignCaseQueueCore,
} from "./queues-core";

const SEVERITIES: readonly CaseSeverity[] = ["low", "medium", "high", "critical"];
const NOTIFY_TARGETS = ["assignee", "queue_members", "watchers"] as const;
export type NotifyTarget = (typeof NOTIFY_TARGETS)[number];

export type EscalationConditions = {
  /** Case must have been open at least this long. */
  minAgeMinutes?: number;
  /** Case must be unacknowledged for at least this long. */
  minUnacknowledgedMinutes?: number;
  /** Only these severities match; empty/undefined matches any severity. */
  severities?: CaseSeverity[];
  waitingReason?: "third_party" | "approval";
};

function parseConditions(value: unknown): EscalationConditions {
  if (!value || typeof value !== "object") return {};
  const row = value as Record<string, unknown>;
  const conditions: EscalationConditions = {};
  if (typeof row.minAgeMinutes === "number" && row.minAgeMinutes >= 0) {
    conditions.minAgeMinutes = row.minAgeMinutes;
  }
  if (
    typeof row.minUnacknowledgedMinutes === "number" &&
    row.minUnacknowledgedMinutes >= 0
  ) {
    conditions.minUnacknowledgedMinutes = row.minUnacknowledgedMinutes;
  }
  if (Array.isArray(row.severities)) {
    const severities = row.severities.filter((v): v is CaseSeverity =>
      SEVERITIES.includes(v as CaseSeverity),
    );
    if (severities.length > 0) conditions.severities = severities;
  }
  if (row.waitingReason === "third_party" || row.waitingReason === "approval") {
    conditions.waitingReason = row.waitingReason;
  }
  return conditions;
}

export type EscalationEvaluation = {
  matches: boolean;
  reasons: string[];
};

/**
 * Pure evaluation, shared by the live runner and `testEscalationPolicyCore`
 * so "testable" means the same code path a real evaluation would take, not
 * a parallel approximation of it.
 */
export function evaluateEscalationConditions(
  caseRow: Case,
  conditions: EscalationConditions,
  queueId: string | null,
  now = new Date(),
): EscalationEvaluation {
  const reasons: string[] = [];
  if (caseRow.status === "closed") {
    return { matches: false, reasons: ["case is closed"] };
  }
  if (queueId && caseRow.queueId !== queueId) {
    return { matches: false, reasons: ["case is not in the policy's queue"] };
  }
  const ageMinutes = (now.getTime() - caseRow.openedAt.getTime()) / 60_000;
  if (conditions.minAgeMinutes !== undefined) {
    if (ageMinutes < conditions.minAgeMinutes) {
      return { matches: false, reasons: [`case age ${Math.round(ageMinutes)}m below minAgeMinutes ${conditions.minAgeMinutes}`] };
    }
    reasons.push(`case age ${Math.round(ageMinutes)}m >= ${conditions.minAgeMinutes}m`);
  }
  if (conditions.minUnacknowledgedMinutes !== undefined) {
    if (caseRow.acknowledgedAt) {
      return { matches: false, reasons: ["case is already acknowledged"] };
    }
    if (ageMinutes < conditions.minUnacknowledgedMinutes) {
      return {
        matches: false,
        reasons: [`unacknowledged for ${Math.round(ageMinutes)}m, below ${conditions.minUnacknowledgedMinutes}m`],
      };
    }
    reasons.push(`unacknowledged for ${Math.round(ageMinutes)}m >= ${conditions.minUnacknowledgedMinutes}m`);
  }
  if (conditions.severities && conditions.severities.length > 0) {
    if (!conditions.severities.includes(caseRow.severity)) {
      return { matches: false, reasons: [`severity ${caseRow.severity} not in policy's severity list`] };
    }
    reasons.push(`severity ${caseRow.severity} matches policy`);
  }
  if (conditions.waitingReason) {
    if (caseRow.waitingReason !== conditions.waitingReason) {
      return { matches: false, reasons: [`case is not waiting on ${conditions.waitingReason}`] };
    }
    reasons.push(`case is waiting on ${conditions.waitingReason}`);
  }
  return { matches: true, reasons: reasons.length > 0 ? reasons : ["no conditions configured; matches every open case"] };
}

export type EscalationPolicyInput = {
  name: string;
  description?: string | null;
  queueId?: string | null;
  conditions: EscalationConditions;
  notifyEnabled: boolean;
  notifyTargets: NotifyTarget[];
  reassignEnabled: boolean;
  reassignToQueueId?: string | null;
  reassignToUserId?: string | null;
  raiseSeverityEnabled: boolean;
  raiseSeverityTo?: CaseSeverity | null;
};

function validatePolicyInput(input: EscalationPolicyInput): void {
  if (!input.name.trim()) throw new Error("Policy name is required");
  if (input.reassignEnabled && !input.reassignToQueueId && !input.reassignToUserId) {
    throw new Error("A reassign action needs a target queue or analyst");
  }
  if (input.raiseSeverityEnabled && !input.raiseSeverityTo) {
    throw new Error("A raise-severity action needs a target severity");
  }
  if (
    !input.notifyEnabled &&
    !input.reassignEnabled &&
    !input.raiseSeverityEnabled
  ) {
    throw new Error("A policy must enable at least one action");
  }
}

export async function createEscalationPolicyCore(
  organisationId: string,
  actorId: string,
  input: EscalationPolicyInput,
): Promise<{ id: string }> {
  validatePolicyInput(input);
  const id = newId("escpol");
  await db.insert(escalationPolicies).values({
    id,
    organisationId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    queueId: input.queueId ?? null,
    conditions: parseConditions(input.conditions),
    notifyEnabled: input.notifyEnabled,
    notifyTargets: input.notifyEnabled ? input.notifyTargets : [],
    reassignEnabled: input.reassignEnabled,
    reassignToQueueId: input.reassignEnabled ? input.reassignToQueueId ?? null : null,
    reassignToUserId: input.reassignEnabled ? input.reassignToUserId ?? null : null,
    raiseSeverityEnabled: input.raiseSeverityEnabled,
    raiseSeverityTo: input.raiseSeverityEnabled ? input.raiseSeverityTo ?? null : null,
    // New policies always start disabled; an admin must switch them on
    // deliberately (setEscalationPolicyActiveCore).
    isActive: false,
    createdBy: actorId,
  });
  return { id };
}

/** Behavioural edit: bumps revision, does not touch isActive. */
export async function updateEscalationPolicyCore(
  organisationId: string,
  policyId: string,
  input: EscalationPolicyInput,
): Promise<void> {
  validatePolicyInput(input);
  const [existing] = await db
    .select({ revision: escalationPolicies.revision })
    .from(escalationPolicies)
    .where(
      and(
        eq(escalationPolicies.id, policyId),
        eq(escalationPolicies.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Escalation policy not found");
  await db
    .update(escalationPolicies)
    .set({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      queueId: input.queueId ?? null,
      conditions: parseConditions(input.conditions),
      notifyEnabled: input.notifyEnabled,
      notifyTargets: input.notifyEnabled ? input.notifyTargets : [],
      reassignEnabled: input.reassignEnabled,
      reassignToQueueId: input.reassignEnabled ? input.reassignToQueueId ?? null : null,
      reassignToUserId: input.reassignEnabled ? input.reassignToUserId ?? null : null,
      raiseSeverityEnabled: input.raiseSeverityEnabled,
      raiseSeverityTo: input.raiseSeverityEnabled ? input.raiseSeverityTo ?? null : null,
      revision: existing.revision + 1,
      updatedAt: new Date(),
    })
    .where(eq(escalationPolicies.id, policyId));
}

/** Purely a safety switch: never changes revision or triggers a re-run. */
export async function setEscalationPolicyActiveCore(
  organisationId: string,
  policyId: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(escalationPolicies)
    .set({ isActive, updatedAt: new Date() })
    .where(
      and(
        eq(escalationPolicies.id, policyId),
        eq(escalationPolicies.organisationId, organisationId),
      ),
    );
}

export async function listEscalationPoliciesCore(organisationId: string) {
  return db
    .select()
    .from(escalationPolicies)
    .where(eq(escalationPolicies.organisationId, organisationId))
    .orderBy(escalationPolicies.name);
}

export type EscalationTestResult = EscalationEvaluation & {
  wouldNotifyTargets: NotifyTarget[];
  wouldReassignToQueueId: string | null;
  wouldReassignToUserId: string | null;
  wouldRaiseSeverityTo: CaseSeverity | null;
};

/**
 * Dry run: evaluates a policy against one case using the exact same
 * condition evaluator the live runner uses, but never writes an
 * escalation_policy_runs row and never applies an action. This is the
 * "testable" half of the acceptance criteria.
 */
export async function testEscalationPolicyCore(
  organisationId: string,
  policyId: string,
  caseId: string,
): Promise<EscalationTestResult> {
  const [policy] = await db
    .select()
    .from(escalationPolicies)
    .where(
      and(
        eq(escalationPolicies.id, policyId),
        eq(escalationPolicies.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!policy) throw new Error("Escalation policy not found");
  const [caseRow] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!caseRow) throw new Error("Case not found");
  const evaluation = evaluateEscalationConditions(
    caseRow,
    parseConditions(policy.conditions),
    policy.queueId,
  );
  return {
    ...evaluation,
    wouldNotifyTargets: policy.notifyEnabled
      ? (policy.notifyTargets as NotifyTarget[])
      : [],
    wouldReassignToQueueId: policy.reassignEnabled ? policy.reassignToQueueId : null,
    wouldReassignToUserId: policy.reassignEnabled ? policy.reassignToUserId : null,
    wouldRaiseSeverityTo: policy.raiseSeverityEnabled ? policy.raiseSeverityTo : null,
  };
}

async function applyNotify(
  policy: EscalationPolicy,
  caseRow: Case,
): Promise<boolean> {
  const targets = new Set(policy.notifyTargets as NotifyTarget[]);
  const recipientIds = new Set<string>();
  if (targets.has("assignee") && caseRow.assigneeId) {
    recipientIds.add(caseRow.assigneeId);
  }
  if (targets.has("queue_members") && caseRow.queueId) {
    const members = await db
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .innerJoin(queues, eq(queues.teamId, teamMembers.teamId))
      .where(eq(queues.id, caseRow.queueId));
    for (const row of members) recipientIds.add(row.userId);
  }
  if (targets.has("watchers")) {
    const watchers = await db
      .select({ userId: caseWatchers.userId })
      .from(caseWatchers)
      .where(eq(caseWatchers.caseId, caseRow.id));
    for (const row of watchers) recipientIds.add(row.userId);
  }
  if (recipientIds.size === 0) return false;
  const recipients = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, [...recipientIds]));
  const url = `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${caseRow.id}`;
  await Promise.all(
    recipients.map((recipient) =>
      sendEmail({
        to: recipient.email,
        subject: `[Kelpie] Escalation: ${policy.name} on ${caseRow.caseNumber}`,
        text:
          `${caseRow.caseNumber} — ${caseRow.title}\n` +
          `Escalation policy "${policy.name}" fired on this case.\n` +
          `${url}\n`,
      }).catch(() => {}),
    ),
  );
  await queueMobilePushForUsers(
    caseRow.organisationId,
    [...recipientIds],
    {
      event: "escalation_triggered",
      sourceId: `${policy.id}:${policy.revision}:${caseRow.id}`,
      title: "Kelpie escalation",
      body: `${caseRow.caseNumber}: "${policy.name}" fired.`,
      destinationType: "case",
      destinationId: caseRow.id,
    },
  );
  return true;
}

/**
 * Evaluate every active escalation policy against every open case in scope
 * and apply notify/reassign/raise-severity actions for first-time matches.
 * Intended to run on a schedule from the jobs worker
 * (src/lib/jobs/handlers.ts), the same way runSlaChecks does.
 */
export async function runEscalationPolicies(): Promise<{
  scanned: number;
  triggered: number;
}> {
  const policies = await db
    .select()
    .from(escalationPolicies)
    .where(eq(escalationPolicies.isActive, true));
  let triggered = 0;
  let scanned = 0;
  for (const policy of policies) {
    const conditions = parseConditions(policy.conditions);
    const openCases = await db
      .select()
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, policy.organisationId),
          sql`${cases.status} <> 'closed'`,
          policy.queueId ? eq(cases.queueId, policy.queueId) : sql`true`,
        ),
      );
    scanned += openCases.length;
    for (const caseRow of openCases) {
      const evaluation = evaluateEscalationConditions(
        caseRow,
        conditions,
        policy.queueId,
      );
      if (!evaluation.matches) continue;
      const [inserted] = await db
        .insert(escalationPolicyRuns)
        .values({
          id: newId("escrun"),
          organisationId: policy.organisationId,
          policyId: policy.id,
          policyRevision: policy.revision,
          caseId: caseRow.id,
          triggerReason: evaluation.reasons.join("; "),
        })
        .onConflictDoNothing()
        .returning({ id: escalationPolicyRuns.id });
      if (!inserted) continue; // already escalated this case under this revision
      triggered++;
      let notifySent = false;
      let reassignedToQueueId: string | null = null;
      let reassignedToUserId: string | null = null;
      let severityRaisedTo: CaseSeverity | null = null;
      if (policy.notifyEnabled) {
        notifySent = await applyNotify(policy, caseRow);
      }
      if (policy.reassignEnabled) {
        if (policy.reassignToQueueId) {
          await assignCaseQueueCore(
            policy.organisationId,
            null,
            caseRow.id,
            policy.reassignToQueueId,
          );
          reassignedToQueueId = policy.reassignToQueueId;
        }
        if (policy.reassignToUserId) {
          await assignCaseAnalystCore(
            policy.organisationId,
            null,
            caseRow.id,
            policy.reassignToUserId,
          );
          reassignedToUserId = policy.reassignToUserId;
        }
      }
      if (policy.raiseSeverityEnabled && policy.raiseSeverityTo) {
        const rank = SEVERITIES.indexOf(policy.raiseSeverityTo);
        const currentRank = SEVERITIES.indexOf(caseRow.severity);
        if (rank > currentRank) {
          await db
            .update(cases)
            .set({ severity: policy.raiseSeverityTo, version: sql`${cases.version} + 1` })
            .where(eq(cases.id, caseRow.id));
          severityRaisedTo = policy.raiseSeverityTo;
        }
      }
      await db
        .update(escalationPolicyRuns)
        .set({ notifySent, reassignedToQueueId, reassignedToUserId, severityRaisedTo })
        .where(eq(escalationPolicyRuns.id, inserted.id));
      await writeTimelineEvent({
        caseId: caseRow.id,
        actorId: null,
        eventType: "escalation_triggered",
        payload: {
          policy_id: policy.id,
          policy_name: policy.name,
          policy_revision: policy.revision,
          reason: evaluation.reasons.join("; "),
          notify_sent: notifySent,
          reassigned_to_queue_id: reassignedToQueueId,
          reassigned_to_user_id: reassignedToUserId,
          severity_raised_to: severityRaisedTo,
        },
      });
    }
  }
  return { scanned, triggered };
}

export { parseConditions as parseEscalationConditions };
export const ESCALATION_NOTIFY_TARGETS = NOTIFY_TARGETS;
