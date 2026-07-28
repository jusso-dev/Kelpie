"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  attachAlertsToCaseCore,
  CorrelationError,
  CorrelationVersionConflictError,
  createCaseFromAlertsCore,
  mergeCasesCore,
  moveAlertsCore,
  reverseMergeCore,
  splitAlertsCore,
} from "@/lib/correlation/membership-core";
import {
  acceptSuggestionCore,
  evaluateCorrelationCore,
  rejectSuggestionCore,
} from "@/lib/correlation/evaluate-core";
import {
  createCorrelationRuleCore,
  ensureDefaultCorrelationRule,
  updateCorrelationRuleCore,
} from "@/lib/correlation/rules-core";
import { correlationPolicyPatch, parseCorrelationPolicy } from "@/lib/correlation/policy";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/audit/events";

function revalidateCase(caseId: string) {
  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/alerts`);
  revalidatePath("/cases");
}

function mapError(err: unknown): { ok: false; error: string; status: number; current?: unknown } {
  if (err instanceof CorrelationVersionConflictError) {
    return { ok: false, error: "version_conflict", status: 409, current: err.current };
  }
  if (err instanceof CorrelationError) {
    return { ok: false, error: err.message, status: err.status };
  }
  throw err;
}

export async function moveAlertsAction(input: {
  alertIds: string[];
  fromCaseId: string;
  toCaseId: string;
  reason: string;
  expectedVersions?: Record<string, number>;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await moveAlertsCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidateCase(input.fromCaseId);
    revalidateCase(input.toCaseId);
    return { ok: true as const, ...result };
  } catch (err) {
    return mapError(err);
  }
}

export async function mergeCasesAction(input: {
  canonicalCaseId: string;
  sourceCaseIds: string[];
  reason: string;
  expectedVersions?: Record<string, number>;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await mergeCasesCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidateCase(input.canonicalCaseId);
    for (const id of input.sourceCaseIds) revalidateCase(id);
    return { ok: true as const, mergeId: result.merge.id, ...result };
  } catch (err) {
    return mapError(err);
  }
}

export async function reverseMergeAction(input: {
  mergeId: string;
  reason: string;
  expectedVersions?: Record<string, number>;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await reverseMergeCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidatePath("/cases");
    return { ok: true as const, ...result };
  } catch (err) {
    return mapError(err);
  }
}

export async function splitAlertsAction(input: {
  fromCaseId: string;
  alertIds: string[];
  reason: string;
  title?: string;
  expectedVersions?: Record<string, number>;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await splitAlertsCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidateCase(input.fromCaseId);
    revalidateCase(result.caseId);
    return { ok: true as const, ...result };
  } catch (err) {
    return mapError(err);
  }
}

export async function attachAlertsAction(input: {
  caseId: string;
  alertIds: string[];
  reason: string;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await attachAlertsToCaseCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidateCase(input.caseId);
    return { ok: true as const, ...result };
  } catch (err) {
    return mapError(err);
  }
}

export async function createCaseFromAlertsAction(input: {
  alertIds: string[];
  reason: string;
  title?: string;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await createCaseFromAlertsCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidateCase(result.caseId);
    return { ok: true as const, ...result };
  } catch (err) {
    return mapError(err);
  }
}

export async function rejectSuggestionAction(input: {
  suggestionId: string;
  reason: string;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const suggestion = await rejectSuggestionCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidatePath("/cases");
    return { ok: true as const, suggestion };
  } catch (err) {
    return mapError(err);
  }
}

export async function acceptSuggestionAction(input: {
  suggestionId: string;
  reason: string;
  expectedVersions?: Record<string, number>;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const accepted = await acceptSuggestionCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ...input,
    });
    revalidatePath("/cases");
    return { ok: true as const, ...accepted };
  } catch (err) {
    return mapError(err);
  }
}

export async function evaluateCorrelationAction(input?: {
  ruleId?: string;
  forceDryRun?: boolean;
}) {
  const user = await requireRole(["admin", "analyst"]);
  try {
    await ensureDefaultCorrelationRule(user.organisationId, user.id);
    const results = await evaluateCorrelationCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ruleId: input?.ruleId,
      forceDryRun: input?.forceDryRun,
    });
    revalidatePath("/cases");
    return { ok: true as const, results };
  } catch (err) {
    return mapError(err);
  }
}

export async function updateCorrelationPolicyAction(input: {
  autoMergeEnabled?: boolean;
  autoAcceptThreshold?: number | null;
  mergeSafetyWindowHours?: number;
}) {
  const user = await requireRole(["admin"]);
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, user.organisationId))
    .limit(1);
  const current =
    org?.settings && typeof org.settings === "object"
      ? (org.settings as Record<string, unknown>)
      : {};
  const next = correlationPolicyPatch(current, input);
  await db
    .update(organisations)
    .set({ settings: next })
    .where(eq(organisations.id, user.organisationId));
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    action: "correlation.policy_updated",
    targetType: "organisation",
    targetId: user.organisationId,
    metadata: { policy: next.correlation },
  });
  revalidatePath("/settings");
  return { ok: true as const, policy: parseCorrelationPolicy(next) };
}

export async function createCorrelationRuleAction(input: {
  ruleKey: string;
  name: string;
  description?: string;
  dryRun?: boolean;
  activate?: boolean;
  scoreThreshold?: number;
}) {
  const user = await requireRole(["admin"]);
  try {
    const rule = await createCorrelationRuleCore({
      organisationId: user.organisationId,
      actorId: user.id,
      input,
    });
    revalidatePath("/settings");
    return { ok: true as const, rule };
  } catch (err) {
    return mapError(err);
  }
}

export async function setCorrelationRuleDryRunAction(input: {
  ruleId: string;
  dryRun: boolean;
}) {
  const user = await requireRole(["admin"]);
  try {
    const rule = await updateCorrelationRuleCore({
      organisationId: user.organisationId,
      actorId: user.id,
      ruleId: input.ruleId,
      input: { dryRun: input.dryRun },
    });
    revalidatePath("/settings");
    return { ok: true as const, rule };
  } catch (err) {
    return mapError(err);
  }
}
