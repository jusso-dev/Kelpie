/**
 * Core escalation-policy CRUD and run-history queries, callable from both
 * server actions and API routes.
 *
 * SECURITY INVARIANT (do not weaken): escalation policies can only notify
 * someone, reassign a case, or raise a case's severity by one tier. This
 * file — and its executor, `src/lib/escalation-runner.ts` — must NEVER
 * import anything from `src/lib/response-actions/*` (the SOAR / destructive
 * response-action subsystem: Cloudflare block IP, Entra disable user,
 * CrowdStrike isolate host, etc). That is enforced structurally: there is no
 * such import in either file, so an escalation policy has no code path that
 * could ever reach a destructive action, regardless of what is stored in
 * `triggerConfig`/`actions`. The zod schemas below are the second layer of
 * defence — they reject any action object whose `type` is not exactly one
 * of "notify" | "reassign" | "raise_severity", or whose shape doesn't match
 * that action's schema exactly (`.strict()`, so unknown keys are rejected
 * too).
 */

import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { escalationPolicies, escalationRuns } from "@/db/schema";
import type { EscalationPolicy, EscalationRun } from "@/db/schema";
import { CASE_ENUMS } from "@/lib/cases-core";
import { newId } from "@/lib/utils";

export class EscalationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EscalationError";
    this.status = status;
  }
}

/** Analogous to `CaseVersionConflictError` in `cases-core.ts`. */
export class EscalationVersionConflictError extends Error {
  current: EscalationPolicy;
  constructor(current: EscalationPolicy) {
    super("escalation_policy_version_conflict");
    this.name = "EscalationVersionConflictError";
    this.current = current;
  }
}

export const ESCALATION_TRIGGER_TYPES = [
  "age_minutes",
  "sla_warning",
  "sla_breached",
  "stale_status",
] as const;
export type EscalationTriggerType = (typeof ESCALATION_TRIGGER_TYPES)[number];

export const ESCALATION_ACTION_TYPES = [
  "notify",
  "reassign",
  "raise_severity",
] as const;
export type EscalationActionType = (typeof ESCALATION_ACTION_TYPES)[number];

/**
 * `cooldownMinutes` applies to every trigger type: a policy must not re-fire
 * on the same case+policy-version combination more often than this. Default
 * is 60 minutes, chosen so a 60-second sweep tick doesn't spam the same
 * notification/reassignment/severity-raise every minute forever, while still
 * re-checking within the hour if the underlying condition persists.
 */
const DEFAULT_COOLDOWN_MINUTES = 60;
const cooldownField = () =>
  z.number().int().positive().max(10_080).default(DEFAULT_COOLDOWN_MINUTES);

/** `triggerConfig` shape for `triggerType: "age_minutes"`. */
const ageMinutesConfigSchema = z
  .object({
    ageMinutes: z.number().int().positive(),
    severities: z.array(z.enum(CASE_ENUMS.severity)).min(1).optional(),
    cooldownMinutes: cooldownField(),
  })
  .strict();

/** `triggerConfig` shape for `triggerType: "sla_warning" | "sla_breached"`. */
const slaGateConfigSchema = z
  .object({
    gate: z.enum(["acknowledge", "contain", "resolve"]).optional(),
    cooldownMinutes: cooldownField(),
  })
  .strict();

/** `triggerConfig` shape for `triggerType: "stale_status"`. */
const staleStatusConfigSchema = z
  .object({
    status: z.enum(CASE_ENUMS.status),
    staleAfterMinutes: z.number().int().positive(),
    cooldownMinutes: cooldownField(),
  })
  .strict();

export type AgeMinutesTriggerConfig = z.infer<typeof ageMinutesConfigSchema>;
export type SlaGateTriggerConfig = z.infer<typeof slaGateConfigSchema>;
export type StaleStatusTriggerConfig = z.infer<typeof staleStatusConfigSchema>;

function triggerConfigSchemaFor(triggerType: EscalationTriggerType) {
  switch (triggerType) {
    case "age_minutes":
      return ageMinutesConfigSchema;
    case "sla_warning":
    case "sla_breached":
      return slaGateConfigSchema;
    case "stale_status":
      return staleStatusConfigSchema;
  }
}

function parseTriggerConfig(
  triggerType: EscalationTriggerType,
  raw: unknown,
): Record<string, unknown> {
  const schema = triggerConfigSchemaFor(triggerType);
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new EscalationError(
      `Invalid trigger configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      400,
    );
  }
  return parsed.data;
}

/**
 * `actions` shape (verbatim, per array element):
 *   { type: "notify", channel?: "email" | "push" | "both" }
 *   { type: "reassign", assigneeId: string }
 *   { type: "raise_severity" }
 * Any other `type`, or extra/missing keys on a recognised type, is rejected
 * with a 400 `EscalationError`. At least one action is required.
 */
const notifyActionSchema = z
  .object({
    type: z.literal("notify"),
    channel: z.enum(["email", "push", "both"]).optional(),
  })
  .strict();

const reassignActionSchema = z
  .object({
    type: z.literal("reassign"),
    assigneeId: z.string().min(1),
  })
  .strict();

const raiseSeverityActionSchema = z
  .object({
    type: z.literal("raise_severity"),
  })
  .strict();

const escalationActionSchema = z.discriminatedUnion("type", [
  notifyActionSchema,
  reassignActionSchema,
  raiseSeverityActionSchema,
]);

const escalationActionsSchema = z.array(escalationActionSchema).min(1).max(10);

export type NotifyAction = z.infer<typeof notifyActionSchema>;
export type ReassignAction = z.infer<typeof reassignActionSchema>;
export type RaiseSeverityAction = z.infer<typeof raiseSeverityActionSchema>;
export type EscalationAction = z.infer<typeof escalationActionSchema>;

function parseActions(raw: unknown): EscalationAction[] {
  const parsed = escalationActionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new EscalationError(
      `Invalid actions: ${parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ")}`,
      400,
    );
  }
  return parsed.data;
}

async function loadPolicyInOrg(
  organisationId: string,
  policyId: string,
): Promise<EscalationPolicy | null> {
  const [row] = await db
    .select()
    .from(escalationPolicies)
    .where(
      and(
        eq(escalationPolicies.id, policyId),
        eq(escalationPolicies.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export type CreatePolicyInput = {
  name: string;
  description?: string;
  triggerType: EscalationTriggerType;
  triggerConfig: Record<string, unknown>;
  actions: unknown[];
};

export async function createPolicyCore(
  organisationId: string,
  actorId: string | null,
  input: CreatePolicyInput,
): Promise<{ id: string }> {
  const name = input.name?.trim();
  if (!name) throw new EscalationError("Name is required", 400);
  if (!ESCALATION_TRIGGER_TYPES.includes(input.triggerType)) {
    throw new EscalationError("Unknown trigger type", 400);
  }
  const triggerConfig = parseTriggerConfig(input.triggerType, input.triggerConfig);
  const actions = parseActions(input.actions);

  const [existing] = await db
    .select({ id: escalationPolicies.id })
    .from(escalationPolicies)
    .where(
      and(
        eq(escalationPolicies.organisationId, organisationId),
        eq(escalationPolicies.name, name),
      ),
    )
    .limit(1);
  if (existing) {
    throw new EscalationError("A policy with this name already exists", 409);
  }

  const id = newId("escpol");
  const [inserted] = await db
    .insert(escalationPolicies)
    .values({
      id,
      organisationId,
      name,
      description: input.description?.trim() || null,
      triggerType: input.triggerType,
      triggerConfig,
      actions,
      createdBy: actorId,
    })
    .onConflictDoNothing()
    .returning({ id: escalationPolicies.id });
  if (!inserted) {
    throw new EscalationError("A policy with this name already exists", 409);
  }
  return inserted;
}

export async function listPoliciesCore(
  organisationId: string,
  opts?: { includeDisabled?: boolean },
): Promise<EscalationPolicy[]> {
  const conditions = [eq(escalationPolicies.organisationId, organisationId)];
  if (!opts?.includeDisabled) {
    conditions.push(eq(escalationPolicies.isActive, true));
  }
  return db
    .select()
    .from(escalationPolicies)
    .where(and(...conditions))
    .orderBy(desc(escalationPolicies.createdAt));
}

export async function getPolicyCore(
  organisationId: string,
  policyId: string,
): Promise<EscalationPolicy | null> {
  return loadPolicyInOrg(organisationId, policyId);
}

export type UpdatePolicyPatch = Partial<{
  name: string;
  description: string | null;
  triggerConfig: Record<string, unknown>;
  actions: unknown[];
}>;

export async function updatePolicyCore(
  organisationId: string,
  actorId: string | null,
  policyId: string,
  patch: UpdatePolicyPatch,
  expectedVersion: number,
): Promise<EscalationPolicy> {
  const existing = await loadPolicyInOrg(organisationId, policyId);
  if (!existing) throw new EscalationError("Policy not found", 404);
  if (expectedVersion !== existing.version) {
    throw new EscalationVersionConflictError(existing);
  }

  const set: Partial<typeof escalationPolicies.$inferInsert> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new EscalationError("Name is required", 400);
    if (name !== existing.name) {
      const [conflict] = await db
        .select({ id: escalationPolicies.id })
        .from(escalationPolicies)
        .where(
          and(
            eq(escalationPolicies.organisationId, organisationId),
            eq(escalationPolicies.name, name),
          ),
        )
        .limit(1);
      if (conflict) {
        throw new EscalationError("A policy with this name already exists", 409);
      }
      set.name = name;
    }
  }
  if (patch.description !== undefined) {
    set.description = patch.description?.trim() || null;
  }
  if (patch.triggerConfig !== undefined) {
    // triggerType is immutable on update; re-validate against the existing type.
    set.triggerConfig = parseTriggerConfig(existing.triggerType, patch.triggerConfig);
  }
  if (patch.actions !== undefined) {
    set.actions = parseActions(patch.actions);
  }

  if (Object.keys(set).length === 0) return existing;
  set.version = existing.version + 1;
  set.updatedAt = new Date();

  const [updated] = await db
    .update(escalationPolicies)
    .set(set)
    .where(
      and(
        eq(escalationPolicies.id, policyId),
        eq(escalationPolicies.organisationId, organisationId),
        eq(escalationPolicies.version, expectedVersion),
      ),
    )
    .returning();
  if (!updated) {
    const current = await loadPolicyInOrg(organisationId, policyId);
    if (!current) throw new EscalationError("Policy not found", 404);
    throw new EscalationVersionConflictError(current);
  }
  return updated;
}

/**
 * Disabling is a single atomic UPDATE gated on the expected version, so a
 * policy is never left half-applied: either the whole disable succeeds
 * (isActive/disabledAt/disabledBy/version all move together) or nothing
 * changes and the caller gets a version conflict.
 */
export async function disablePolicyCore(
  organisationId: string,
  actorId: string | null,
  policyId: string,
  expectedVersion: number,
): Promise<EscalationPolicy> {
  const existing = await loadPolicyInOrg(organisationId, policyId);
  if (!existing) throw new EscalationError("Policy not found", 404);
  if (expectedVersion !== existing.version) {
    throw new EscalationVersionConflictError(existing);
  }
  const [updated] = await db
    .update(escalationPolicies)
    .set({
      isActive: false,
      disabledAt: new Date(),
      disabledBy: actorId,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(escalationPolicies.id, policyId),
        eq(escalationPolicies.organisationId, organisationId),
        eq(escalationPolicies.version, expectedVersion),
      ),
    )
    .returning();
  if (!updated) {
    const current = await loadPolicyInOrg(organisationId, policyId);
    if (!current) throw new EscalationError("Policy not found", 404);
    throw new EscalationVersionConflictError(current);
  }
  return updated;
}

export async function enablePolicyCore(
  organisationId: string,
  actorId: string | null,
  policyId: string,
  expectedVersion: number,
): Promise<EscalationPolicy> {
  const existing = await loadPolicyInOrg(organisationId, policyId);
  if (!existing) throw new EscalationError("Policy not found", 404);
  if (expectedVersion !== existing.version) {
    throw new EscalationVersionConflictError(existing);
  }
  const [updated] = await db
    .update(escalationPolicies)
    .set({
      isActive: true,
      disabledAt: null,
      disabledBy: null,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(escalationPolicies.id, policyId),
        eq(escalationPolicies.organisationId, organisationId),
        eq(escalationPolicies.version, expectedVersion),
      ),
    )
    .returning();
  if (!updated) {
    const current = await loadPolicyInOrg(organisationId, policyId);
    if (!current) throw new EscalationError("Policy not found", 404);
    throw new EscalationVersionConflictError(current);
  }
  // `actorId` intentionally unused: re-enabling has no dedicated audit column
  // on the row (unlike disable's disabledBy); the actor is captured by the
  // caller's own audit/timeline logging where applicable.
  void actorId;
  return updated;
}

export async function listRunsCore(
  organisationId: string,
  policyId: string,
  limit = 50,
): Promise<EscalationRun[]> {
  return db
    .select()
    .from(escalationRuns)
    .where(
      and(
        eq(escalationRuns.organisationId, organisationId),
        eq(escalationRuns.policyId, policyId),
      ),
    )
    .orderBy(desc(escalationRuns.triggeredAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
