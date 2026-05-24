import { db } from "@/db";
import { cases, slaPolicies, type Case, type SlaPolicy } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export const DEFAULT_SLA_POLICIES = [
  {
    name: "Critical",
    severity: "critical" as const,
    timeToAcknowledgeMinutes: 15,
    timeToContainMinutes: 60,
    timeToResolveMinutes: 4 * 60,
  },
  {
    name: "High",
    severity: "high" as const,
    timeToAcknowledgeMinutes: 30,
    timeToContainMinutes: 4 * 60,
    timeToResolveMinutes: 12 * 60,
  },
  {
    name: "Medium",
    severity: "medium" as const,
    timeToAcknowledgeMinutes: 2 * 60,
    timeToContainMinutes: 12 * 60,
    timeToResolveMinutes: 2 * 24 * 60,
  },
  {
    name: "Low",
    severity: "low" as const,
    timeToAcknowledgeMinutes: 8 * 60,
    timeToContainMinutes: 2 * 24 * 60,
    timeToResolveMinutes: 5 * 24 * 60,
  },
];

export const WARNING_WINDOW_MINUTES = 15;

export type SlaGate = "acknowledge" | "contain" | "resolve";

export type SlaTargetEvaluation = {
  gate: SlaGate;
  deadline: Date;
  achievedAt: Date | null;
  isBreached: boolean;
  isWarning: boolean;
  minutesOver: number;
  minutesUntil: number;
};

export type SlaEvaluation = {
  policy: SlaPolicy;
  targets: SlaTargetEvaluation[];
};

export type SlaStateRecord = {
  warned?: Partial<Record<SlaGate, string>>;
  breached?: Partial<Record<SlaGate, string>>;
};

export async function loadSlaPolicy(
  organisationId: string,
  severity: Case["severity"],
): Promise<SlaPolicy | null> {
  const [row] = await db
    .select()
    .from(slaPolicies)
    .where(
      and(
        eq(slaPolicies.organisationId, organisationId),
        eq(slaPolicies.severity, severity),
      ),
    )
    .limit(1);
  return row ?? null;
}

export function evaluateSla(c: Case, policy: SlaPolicy, now = new Date()): SlaEvaluation {
  const opened = c.openedAt.getTime();
  function build(gate: SlaGate, minutes: number, achievedAt: Date | null): SlaTargetEvaluation {
    const deadline = new Date(opened + minutes * 60000);
    const isAchieved = achievedAt !== null && achievedAt <= deadline;
    const overdueMs = now.getTime() - deadline.getTime();
    const isBreached = !isAchieved && overdueMs > 0;
    const isWarning =
      !isAchieved &&
      !isBreached &&
      overdueMs > -WARNING_WINDOW_MINUTES * 60000;
    return {
      gate,
      deadline,
      achievedAt,
      isBreached,
      isWarning,
      minutesOver: isBreached ? Math.round(overdueMs / 60000) : 0,
      minutesUntil: Math.round(-overdueMs / 60000),
    };
  }
  return {
    policy,
    targets: [
      build("acknowledge", policy.timeToAcknowledgeMinutes, c.acknowledgedAt ?? null),
      build("contain", policy.timeToContainMinutes, c.containedAt ?? null),
      build("resolve", policy.timeToResolveMinutes, c.resolvedAt ?? null),
    ],
  };
}

export function nextOpenGate(evaluation: SlaEvaluation): SlaTargetEvaluation | null {
  return evaluation.targets.find((t) => t.achievedAt === null) ?? null;
}
