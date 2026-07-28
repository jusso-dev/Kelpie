import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationSyncPolicies,
  type IntegrationSyncPolicy,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import {
  DEFAULT_CASE_SOURCE_FIELD_POLICIES,
  DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
  type ConnectionKind,
  type FieldOwnership,
  type SyncField,
  isFieldOwnership,
  isSyncField,
} from "./types";

export type FieldPolicyMap = Partial<Record<SyncField, FieldOwnership>>;

export function defaultFieldPolicies(
  connectionKind: ConnectionKind,
): FieldPolicyMap {
  if (connectionKind === "case_source" || connectionKind === "inbound_source") {
    return { ...DEFAULT_CASE_SOURCE_FIELD_POLICIES };
  }
  // Non-case connectors default to one-way inbound with no case field writes.
  return {};
}

export function parseFieldPolicies(raw: unknown): FieldPolicyMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FieldPolicyMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isSyncField(key)) continue;
    if (typeof value !== "string" || !isFieldOwnership(value)) continue;
    out[key] = value;
  }
  return out;
}

export function mergeFieldPolicies(
  base: FieldPolicyMap,
  override: FieldPolicyMap,
): FieldPolicyMap {
  return { ...base, ...override };
}

/**
 * Load the policy for a connection, materialising defaults on first use so
 * outbound remains disabled and field ownership is explicit.
 */
export async function getOrCreateSyncPolicy(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
}): Promise<IntegrationSyncPolicy> {
  const [existing] = await db
    .select()
    .from(integrationSyncPolicies)
    .where(
      and(
        eq(integrationSyncPolicies.organisationId, opts.organisationId),
        eq(integrationSyncPolicies.connectionKind, opts.connectionKind),
        eq(integrationSyncPolicies.connectionId, opts.connectionId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const defaults = defaultFieldPolicies(opts.connectionKind);
  const [inserted] = await db
    .insert(integrationSyncPolicies)
    .values({
      id: newId("intpol"),
      organisationId: opts.organisationId,
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
      fieldPolicies: defaults,
      outboundEnabled: false,
      outboundScopes: [],
      freshnessThresholdMinutes: DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;

  const [again] = await db
    .select()
    .from(integrationSyncPolicies)
    .where(
      and(
        eq(integrationSyncPolicies.organisationId, opts.organisationId),
        eq(integrationSyncPolicies.connectionKind, opts.connectionKind),
        eq(integrationSyncPolicies.connectionId, opts.connectionId),
      ),
    )
    .limit(1);
  if (!again) throw new Error("Could not resolve sync policy");
  return again;
}

export async function updateSyncPolicy(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  fieldPolicies?: FieldPolicyMap;
  outboundEnabled?: boolean;
  outboundScopes?: string[];
  freshnessThresholdMinutes?: number;
}): Promise<IntegrationSyncPolicy> {
  const current = await getOrCreateSyncPolicy(opts);
  const nextPolicies = opts.fieldPolicies
    ? mergeFieldPolicies(parseFieldPolicies(current.fieldPolicies), opts.fieldPolicies)
    : parseFieldPolicies(current.fieldPolicies);

  if (opts.outboundEnabled === true) {
    // Outbound requires at least one scope string so enablement is deliberate.
    const scopes = opts.outboundScopes ?? (current.outboundScopes as string[]);
    if (!Array.isArray(scopes) || scopes.length === 0) {
      throw new Error(
        "Outbound write access requires explicit scopes plus per-field policy",
      );
    }
  }

  if (
    opts.freshnessThresholdMinutes !== undefined &&
    (!Number.isInteger(opts.freshnessThresholdMinutes) ||
      opts.freshnessThresholdMinutes < 1 ||
      opts.freshnessThresholdMinutes > 10080)
  ) {
    throw new Error("Freshness threshold must be between 1 minute and 7 days");
  }

  const [updated] = await db
    .update(integrationSyncPolicies)
    .set({
      fieldPolicies: nextPolicies,
      outboundEnabled:
        opts.outboundEnabled === undefined
          ? current.outboundEnabled
          : opts.outboundEnabled,
      outboundScopes:
        opts.outboundScopes === undefined
          ? current.outboundScopes
          : opts.outboundScopes,
      freshnessThresholdMinutes:
        opts.freshnessThresholdMinutes === undefined
          ? current.freshnessThresholdMinutes
          : opts.freshnessThresholdMinutes,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(integrationSyncPolicies.id, current.id),
        eq(integrationSyncPolicies.organisationId, opts.organisationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Sync policy not found");
  return updated;
}

/**
 * Pure decision: given ownership + values, should inbound source win, should
 * Kelpie keep, or should a conflict be queued?
 */
export type InboundDecision =
  | { action: "apply_source" }
  | { action: "keep_kelpie" }
  | { action: "conflict" }
  | { action: "skip_one_way" };

export function decideInboundField(opts: {
  ownership: FieldOwnership;
  kelpieValue: unknown;
  sourceValue: unknown;
  /** When true, a last-write-wins field treats source as newer. */
  sourceIsNewer: boolean;
}): InboundDecision {
  if (valuesEqual(opts.kelpieValue, opts.sourceValue)) {
    return { action: "keep_kelpie" };
  }
  switch (opts.ownership) {
    case "source_owned":
      return { action: "apply_source" };
    case "kelpie_owned":
      return { action: "keep_kelpie" };
    case "one_way_only":
      // one_way_only = inbound comment-style only; never overwrite case fields
      return { action: "skip_one_way" };
    case "last_write_wins":
      return opts.sourceIsNewer
        ? { action: "apply_source" }
        : { action: "keep_kelpie" };
    case "manual_conflict":
      return { action: "conflict" };
    default:
      return { action: "keep_kelpie" };
  }
}

/**
 * Outbound is allowed only when the connection explicitly enables writes,
 * the field ownership permits source to receive Kelpie changes, and the
 * requested scope is present.
 */
export function canOutboundWrite(opts: {
  outboundEnabled: boolean;
  writeEnabledOnConnection: boolean;
  outboundScopes: string[];
  requiredScope: string;
  ownership: FieldOwnership;
}): boolean {
  if (!opts.outboundEnabled) return false;
  if (!opts.writeEnabledOnConnection) return false;
  if (!opts.outboundScopes.includes(opts.requiredScope)) return false;
  // kelpie_owned and last_write_wins can push; source_owned / one_way_only / manual do not auto-push
  return (
    opts.ownership === "kelpie_owned" || opts.ownership === "last_write_wins"
  );
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
