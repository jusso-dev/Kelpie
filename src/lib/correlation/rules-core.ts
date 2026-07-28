/**
 * Organisation-scoped correlation rule CRUD and metrics (issue #56).
 * Rules are versioned: updating an active rule supersedes the previous row
 * and inserts a new version. Dry-run is the default.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  correlationRuleMetrics,
  correlationRules,
  type CorrelationRule,
  type CorrelationRuleMetrics,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { recordAuditEvent } from "@/lib/audit/events";
import {
  DEFAULT_CORRELATION_CONFIG,
  DEFAULT_SCORE_THRESHOLD,
  mergeRuleConfig,
  type CorrelationRuleConfig,
} from "./scoring";
import { CorrelationError } from "./membership-core";

export type CreateCorrelationRuleInput = {
  ruleKey: string;
  name: string;
  description?: string | null;
  config?: Partial<CorrelationRuleConfig> | null;
  scoreThreshold?: number;
  dryRun?: boolean;
  /** When true, activates immediately (still dry-run by default). */
  activate?: boolean;
};

export type UpdateCorrelationRuleInput = {
  name?: string;
  description?: string | null;
  config?: Partial<CorrelationRuleConfig> | null;
  scoreThreshold?: number;
  dryRun?: boolean;
  status?: "draft" | "active" | "disabled";
};

function normalizeRuleKey(key: string): string {
  const k = key.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  if (!k || k.length > 64) {
    throw new CorrelationError(
      "ruleKey must be 1–64 chars of letters, digits, dots, underscores, or hyphens",
    );
  }
  return k;
}

export async function createCorrelationRuleCore(opts: {
  organisationId: string;
  actorId: string | null;
  input: CreateCorrelationRuleInput;
}): Promise<CorrelationRule> {
  const ruleKey = normalizeRuleKey(opts.input.ruleKey);
  const name = opts.input.name.trim();
  if (!name) throw new CorrelationError("Rule name is required");

  const scoreThreshold =
    opts.input.scoreThreshold ?? DEFAULT_SCORE_THRESHOLD;
  if (scoreThreshold < 0 || scoreThreshold > 100) {
    throw new CorrelationError("scoreThreshold must be between 0 and 100");
  }

  // Next version for this key (or 1).
  const [latest] = await db
    .select({ version: correlationRules.version })
    .from(correlationRules)
    .where(
      and(
        eq(correlationRules.organisationId, opts.organisationId),
        eq(correlationRules.ruleKey, ruleKey),
      ),
    )
    .orderBy(desc(correlationRules.version))
    .limit(1);
  const version = (latest?.version ?? 0) + 1;

  // Supersede any currently-active row for this key when activating.
  const status = opts.input.activate ? "active" : "draft";
  if (status === "active") {
    await db
      .update(correlationRules)
      .set({
        status: "superseded",
        supersededAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(correlationRules.organisationId, opts.organisationId),
          eq(correlationRules.ruleKey, ruleKey),
          eq(correlationRules.status, "active"),
        ),
      );
  }

  const config = mergeRuleConfig(opts.input.config);
  const [row] = await db
    .insert(correlationRules)
    .values({
      id: newId("corrul"),
      organisationId: opts.organisationId,
      ruleKey,
      name,
      description: opts.input.description ?? null,
      version,
      status,
      dryRun: opts.input.dryRun ?? true,
      config,
      scoreThreshold,
      createdBy: opts.actorId,
    })
    .returning();

  await ensureMetricsRow(opts.organisationId, ruleKey, version);

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.rule_created",
    targetType: "correlation_rule",
    targetId: row!.id,
    targetLabel: `${ruleKey}@v${version}`,
    metadata: {
      rule_key: ruleKey,
      version,
      status,
      dry_run: row!.dryRun,
      score_threshold: scoreThreshold,
    },
  });

  return row!;
}

/**
 * Create a new version of an existing rule (by id or by key of the latest).
 * Supersedes the previous version when the new status is active.
 */
export async function updateCorrelationRuleCore(opts: {
  organisationId: string;
  actorId: string | null;
  ruleId: string;
  input: UpdateCorrelationRuleInput;
}): Promise<CorrelationRule> {
  const [existing] = await db
    .select()
    .from(correlationRules)
    .where(
      and(
        eq(correlationRules.id, opts.ruleId),
        eq(correlationRules.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new CorrelationError("Rule not found", 404);
  if (existing.status === "superseded") {
    throw new CorrelationError(
      "Cannot update a superseded rule version; create a new version from the active rule",
      409,
    );
  }

  const nextStatus = opts.input.status ?? existing.status;
  const config =
    opts.input.config !== undefined
      ? mergeRuleConfig({
          ...mergeRuleConfig(existing.config as Partial<CorrelationRuleConfig>),
          ...opts.input.config,
        })
      : (existing.config as CorrelationRuleConfig);
  const scoreThreshold =
    opts.input.scoreThreshold ?? existing.scoreThreshold;
  if (scoreThreshold < 0 || scoreThreshold > 100) {
    throw new CorrelationError("scoreThreshold must be between 0 and 100");
  }

  // Version bump when config/threshold/dryRun change or status becomes active
  // from a non-draft path that alters behaviour.
  const materialChange =
    opts.input.config !== undefined ||
    opts.input.scoreThreshold !== undefined ||
    opts.input.dryRun !== undefined ||
    (opts.input.status !== undefined && opts.input.status !== existing.status);

  if (!materialChange && opts.input.name === undefined && opts.input.description === undefined) {
    return existing;
  }

  // In-place update for draft/disabled name-only or non-active; for active
  // rules, material changes create a new version so history stays intact.
  if (existing.status === "active" && materialChange) {
    await db
      .update(correlationRules)
      .set({
        status: "superseded",
        supersededAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(correlationRules.id, existing.id));

    const [row] = await db
      .insert(correlationRules)
      .values({
        id: newId("corrul"),
        organisationId: opts.organisationId,
        ruleKey: existing.ruleKey,
        name: opts.input.name?.trim() || existing.name,
        description:
          opts.input.description !== undefined
            ? opts.input.description
            : existing.description,
        version: existing.version + 1,
        status: nextStatus,
        dryRun: opts.input.dryRun ?? existing.dryRun,
        config,
        scoreThreshold,
        createdBy: opts.actorId,
      })
      .returning();

    await ensureMetricsRow(
      opts.organisationId,
      existing.ruleKey,
      existing.version + 1,
    );

    await recordAuditEvent({
      organisationId: opts.organisationId,
      actorId: opts.actorId,
      actorType: opts.actorId ? "user" : "system",
      action: "correlation.rule_versioned",
      targetType: "correlation_rule",
      targetId: row!.id,
      targetLabel: `${existing.ruleKey}@v${existing.version + 1}`,
      metadata: {
        previous_rule_id: existing.id,
        previous_version: existing.version,
        dry_run: row!.dryRun,
        status: row!.status,
      },
    });
    return row!;
  }

  const [updated] = await db
    .update(correlationRules)
    .set({
      name: opts.input.name?.trim() || existing.name,
      description:
        opts.input.description !== undefined
          ? opts.input.description
          : existing.description,
      dryRun: opts.input.dryRun ?? existing.dryRun,
      config,
      scoreThreshold,
      status: nextStatus,
      updatedAt: new Date(),
      supersededAt: existing.supersededAt,
    })
    .where(eq(correlationRules.id, existing.id))
    .returning();

  if (nextStatus === "active" && existing.status !== "active") {
    await db
      .update(correlationRules)
      .set({
        status: "superseded",
        supersededAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(correlationRules.organisationId, opts.organisationId),
          eq(correlationRules.ruleKey, existing.ruleKey),
          eq(correlationRules.status, "active"),
          sql`${correlationRules.id} <> ${existing.id}`,
        ),
      );
  }

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: opts.actorId ? "user" : "system",
    action: "correlation.rule_updated",
    targetType: "correlation_rule",
    targetId: existing.id,
    targetLabel: `${existing.ruleKey}@v${existing.version}`,
    metadata: {
      status: updated!.status,
      dry_run: updated!.dryRun,
    },
  });

  return updated!;
}

export async function listCorrelationRulesCore(
  organisationId: string,
  opts: { includeSuperseded?: boolean } = {},
): Promise<CorrelationRule[]> {
  const rows = await db
    .select()
    .from(correlationRules)
    .where(eq(correlationRules.organisationId, organisationId))
    .orderBy(desc(correlationRules.updatedAt));
  if (opts.includeSuperseded) return rows;
  return rows.filter((r) => r.status !== "superseded");
}

export async function getCorrelationRuleCore(
  organisationId: string,
  ruleId: string,
): Promise<CorrelationRule | null> {
  const [row] = await db
    .select()
    .from(correlationRules)
    .where(
      and(
        eq(correlationRules.id, ruleId),
        eq(correlationRules.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listActiveRulesForOrg(
  organisationId: string,
): Promise<CorrelationRule[]> {
  return db
    .select()
    .from(correlationRules)
    .where(
      and(
        eq(correlationRules.organisationId, organisationId),
        eq(correlationRules.status, "active"),
      ),
    );
}

async function ensureMetricsRow(
  organisationId: string,
  ruleKey: string,
  ruleVersion: number,
): Promise<void> {
  await db
    .insert(correlationRuleMetrics)
    .values({
      id: newId("cormet"),
      organisationId,
      ruleKey,
      ruleVersion,
    })
    .onConflictDoNothing();
}

export async function bumpRuleMetric(opts: {
  organisationId: string;
  ruleKey: string;
  ruleVersion: number;
  field: "suggestionCount" | "acceptedCount" | "rejectedCount" | "autoAppliedCount";
  by?: number;
}): Promise<void> {
  await ensureMetricsRow(opts.organisationId, opts.ruleKey, opts.ruleVersion);
  const col =
    opts.field === "suggestionCount"
      ? correlationRuleMetrics.suggestionCount
      : opts.field === "acceptedCount"
        ? correlationRuleMetrics.acceptedCount
        : opts.field === "rejectedCount"
          ? correlationRuleMetrics.rejectedCount
          : correlationRuleMetrics.autoAppliedCount;
  await db
    .update(correlationRuleMetrics)
    .set({
      [opts.field]: sql`${col} + ${opts.by ?? 1}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(correlationRuleMetrics.organisationId, opts.organisationId),
        eq(correlationRuleMetrics.ruleKey, opts.ruleKey),
        eq(correlationRuleMetrics.ruleVersion, opts.ruleVersion),
      ),
    );
}

export async function getRuleMetricsCore(
  organisationId: string,
  ruleKey?: string,
): Promise<CorrelationRuleMetrics[]> {
  if (ruleKey) {
    return db
      .select()
      .from(correlationRuleMetrics)
      .where(
        and(
          eq(correlationRuleMetrics.organisationId, organisationId),
          eq(correlationRuleMetrics.ruleKey, ruleKey),
        ),
      )
      .orderBy(desc(correlationRuleMetrics.ruleVersion));
  }
  return db
    .select()
    .from(correlationRuleMetrics)
    .where(eq(correlationRuleMetrics.organisationId, organisationId))
    .orderBy(desc(correlationRuleMetrics.updatedAt));
}

/** Seed a default dry-run rule for an organisation if none exists. */
export async function ensureDefaultCorrelationRule(
  organisationId: string,
  actorId: string | null,
): Promise<CorrelationRule> {
  const existing = await listCorrelationRulesCore(organisationId);
  if (existing.length > 0) return existing[0]!;
  return createCorrelationRuleCore({
    organisationId,
    actorId,
    input: {
      ruleKey: "default-shared-signals",
      name: "Default shared-signal correlation",
      description:
        "Scores alert pairs on shared entities, observables, provider incident id, detection product, time window, tenant, and ATT&CK techniques. Dry-run by default.",
      config: DEFAULT_CORRELATION_CONFIG,
      scoreThreshold: DEFAULT_SCORE_THRESHOLD,
      dryRun: true,
      activate: true,
    },
  });
}
