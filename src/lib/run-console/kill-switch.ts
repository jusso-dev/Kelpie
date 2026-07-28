import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { killSwitches } from "@/db/schema";
import { newId } from "@/lib/utils";
import { recordAuditEvent } from "@/lib/audit/events";

export type KillSwitchScope = "organisation" | "provider" | "action";

/** Maps a governed response-action `kind` to the provider switch that also halts it. */
const PROVIDER_BY_ACTION_KIND: Record<string, string> = {
  cloudflare_block_ip: "cloudflare",
  entra_disable_user: "microsoft_entra",
  defender_isolate_device: "microsoft_defender",
  crowdstrike_isolate_host: "crowdstrike",
};

export function providerForActionKind(kind: string): string | null {
  return PROVIDER_BY_ACTION_KIND[kind] ?? null;
}

/** Automation rules all hand off through the same Muster adapter today. */
export const MUSTER_AUTOMATION_PROVIDER = "muster";

/** Every provider label a switch can name, for the admin kill-switch form. */
export const KNOWN_PROVIDERS = [
  "cloudflare",
  "microsoft_entra",
  "microsoft_defender",
  "crowdstrike",
  MUSTER_AUTOMATION_PROVIDER,
  "mobile_push_apns",
] as const;

export interface KillSwitchCheck {
  active: boolean;
  scope: KillSwitchScope | null;
  reason: string | null;
}

async function loadSwitch(
  organisationId: string,
  scope: KillSwitchScope,
  scopeKey: string,
) {
  const [row] = await db
    .select()
    .from(killSwitches)
    .where(
      and(
        eq(killSwitches.organisationId, organisationId),
        eq(killSwitches.scope, scope),
        eq(killSwitches.scopeKey, scopeKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Checked at both claim time (before a run transitions out of
 * queued/awaiting-approval) and execution time (immediately before a
 * provider call), per issue #67. Organisation scope always wins first since
 * it is the broadest, most prominent switch.
 */
export async function checkKillSwitch(
  organisationId: string,
  opts: { provider?: string | null; actionId?: string | null } = {},
): Promise<KillSwitchCheck> {
  const org = await loadSwitch(organisationId, "organisation", "");
  if (org?.enabled) {
    return { active: true, scope: "organisation", reason: org.reason };
  }
  if (opts.provider) {
    const provider = await loadSwitch(organisationId, "provider", opts.provider);
    if (provider?.enabled) {
      return { active: true, scope: "provider", reason: provider.reason };
    }
  }
  if (opts.actionId) {
    const action = await loadSwitch(organisationId, "action", opts.actionId);
    if (action?.enabled) {
      return { active: true, scope: "action", reason: action.reason };
    }
  }
  return { active: false, scope: null, reason: null };
}

export async function listKillSwitches(organisationId: string) {
  return db
    .select()
    .from(killSwitches)
    .where(eq(killSwitches.organisationId, organisationId));
}

/**
 * Annotates already-built run records with current kill-switch state in a
 * single query per page, rather than one lookup per row. Read-only: does not
 * affect claim/execution enforcement, which always re-checks live (see
 * `checkKillSwitch`) at the moment a run is actually claimed or executed.
 */
export async function annotateKillSwitchState<
  T extends { provider: string | null; actionId: string | null },
>(organisationId: string, records: T[]): Promise<Array<T & {
  killSwitch: { organisationActive: boolean; providerActive: boolean; actionActive: boolean };
}>> {
  const rows = await listKillSwitches(organisationId);
  const org = rows.find((r) => r.scope === "organisation" && r.enabled);
  const providerActive = new Set(
    rows.filter((r) => r.scope === "provider" && r.enabled).map((r) => r.scopeKey),
  );
  const actionActive = new Set(
    rows.filter((r) => r.scope === "action" && r.enabled).map((r) => r.scopeKey),
  );
  return records.map((record) => ({
    ...record,
    killSwitch: {
      organisationActive: Boolean(org),
      providerActive: record.provider ? providerActive.has(record.provider) : false,
      actionActive: record.actionId ? actionActive.has(record.actionId) : false,
    },
  }));
}

/**
 * Prominent, reasoned, audited, scoped toggle. Every flip writes an audit
 * event with the actor and reason, whether it is arming or clearing the
 * switch, and admin-only callers enforce that at the action layer.
 */
export async function setKillSwitch(opts: {
  organisationId: string;
  scope: KillSwitchScope;
  scopeKey?: string;
  enabled: boolean;
  reason: string;
  actorId: string;
}): Promise<void> {
  const reason = opts.reason.trim();
  if (!reason) throw new Error("A reason is required to change a kill switch");
  const scopeKey = opts.scope === "organisation" ? "" : (opts.scopeKey ?? "").trim();
  if (opts.scope !== "organisation" && !scopeKey) {
    throw new Error("A provider or action kill switch requires a scope key");
  }
  const existing = await loadSwitch(opts.organisationId, opts.scope, scopeKey);
  if (existing) {
    await db
      .update(killSwitches)
      .set({
        enabled: opts.enabled,
        reason,
        updatedBy: opts.actorId,
        updatedAt: new Date(),
      })
      .where(eq(killSwitches.id, existing.id));
  } else {
    await db.insert(killSwitches).values({
      id: newId("kswx"),
      organisationId: opts.organisationId,
      scope: opts.scope,
      scopeKey,
      enabled: opts.enabled,
      reason,
      createdBy: opts.actorId,
      updatedBy: opts.actorId,
    });
  }
  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: "user",
    action: opts.enabled ? "run_console.kill_switch_enabled" : "run_console.kill_switch_disabled",
    targetType: "kill_switch",
    targetId: `${opts.scope}:${scopeKey || "org"}`,
    metadata: { scope: opts.scope, scopeKey, reason },
  });
}
