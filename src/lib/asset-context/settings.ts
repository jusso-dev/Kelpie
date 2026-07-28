/**
 * Organisation priority-scoring settings stored in organisations.settings JSON.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import {
  DEFAULT_PRIORITY_SCORING_SETTINGS,
  DEFAULT_STALE_AFTER_HOURS,
  STALE_CONTEXT_POLICIES,
  type PriorityScoringSettings,
  type PriorityWeights,
  type StaleContextPolicy,
} from "./types";
import { normaliseWeights } from "./scoring";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readPriorityScoringSettings(
  settings: unknown,
): PriorityScoringSettings {
  const root = asRecord(settings);
  const raw = asRecord(root.priorityScoring);
  const weightsResult = normaliseWeights(
    raw.weights as Partial<PriorityWeights> | undefined,
  );
  const weights = weightsResult.ok
    ? weightsResult.weights
    : DEFAULT_PRIORITY_SCORING_SETTINGS.weights;

  const policyRaw = raw.staleContextPolicy;
  const staleContextPolicy: StaleContextPolicy =
    typeof policyRaw === "string" &&
    (STALE_CONTEXT_POLICIES as readonly string[]).includes(policyRaw)
      ? (policyRaw as StaleContextPolicy)
      : DEFAULT_PRIORITY_SCORING_SETTINGS.staleContextPolicy;

  const staleAfterHours =
    typeof raw.staleAfterHours === "number" &&
    Number.isFinite(raw.staleAfterHours) &&
    raw.staleAfterHours > 0
      ? Math.min(24 * 90, Math.round(raw.staleAfterHours))
      : DEFAULT_STALE_AFTER_HOURS;

  return {
    enabled: raw.enabled === false ? false : true,
    weights,
    staleContextPolicy,
    staleAfterHours,
  };
}

export async function getPriorityScoringSettings(
  organisationId: string,
): Promise<PriorityScoringSettings> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  if (!row) return { ...DEFAULT_PRIORITY_SCORING_SETTINGS };
  return readPriorityScoringSettings(row.settings);
}

export async function updatePriorityScoringSettings(
  organisationId: string,
  patch: {
    enabled?: boolean;
    weights?: Partial<PriorityWeights>;
    staleContextPolicy?: StaleContextPolicy;
    staleAfterHours?: number;
  },
): Promise<PriorityScoringSettings> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  if (!row) throw new Error("Organisation not found");

  const current = readPriorityScoringSettings(row.settings);
  const nextWeights = patch.weights
    ? normaliseWeights(patch.weights)
    : { ok: true as const, weights: current.weights };
  if (!nextWeights.ok) throw new Error(nextWeights.error);

  if (
    patch.staleContextPolicy &&
    !(STALE_CONTEXT_POLICIES as readonly string[]).includes(
      patch.staleContextPolicy,
    )
  ) {
    throw new Error("Invalid stale context policy");
  }

  const next: PriorityScoringSettings = {
    enabled: patch.enabled ?? current.enabled,
    weights: nextWeights.weights,
    staleContextPolicy: patch.staleContextPolicy ?? current.staleContextPolicy,
    staleAfterHours: patch.staleAfterHours ?? current.staleAfterHours,
  };

  const settings = asRecord(row.settings);
  settings.priorityScoring = next;

  await db
    .update(organisations)
    .set({ settings })
    .where(eq(organisations.id, organisationId));

  return next;
}
