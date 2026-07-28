import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, organisations } from "@/db/schema";

/** Safe floor for the retention setting (issue #45: "a safe minimum"); organisations cannot configure less than this. */
export const MIN_AUDIT_RETENTION_DAYS = 90;
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;

const SETTINGS_KEY = "audit_retention_days";

export function auditRetentionDaysFromSettings(settings: unknown): number {
  const raw = (settings as Record<string, unknown> | null | undefined)?.[SETTINGS_KEY];
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value) || value < MIN_AUDIT_RETENTION_DAYS) {
    return DEFAULT_AUDIT_RETENTION_DAYS;
  }
  return Math.floor(value);
}

export function isValidAuditRetentionDays(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= MIN_AUDIT_RETENTION_DAYS;
}

/** Merges a validated retention value into an organisation's existing `settings` jsonb blob, leaving other keys untouched. */
export function withAuditRetentionSetting(
  settings: Record<string, unknown>,
  days: number,
): Record<string, unknown> {
  return { ...settings, [SETTINGS_KEY]: days };
}

/**
 * Deletes expired `audit_events` rows per organisation. This is the only
 * caller in the codebase allowed to delete audit rows: it sets
 * `kelpie.audit_retention_purge = 'on'` for the duration of its own
 * transaction, which is exactly what the `audit_events_no_delete` trigger
 * (migration 0020) checks for before allowing a delete through.
 */
export async function runAuditRetention(): Promise<{
  organisations: number;
  purged: number;
}> {
  const orgs = await db
    .select({ id: organisations.id, settings: organisations.settings })
    .from(organisations);
  let purged = 0;
  for (const org of orgs) {
    const days = auditRetentionDaysFromSettings(org.settings);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deleted = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL kelpie.audit_retention_purge = 'on'`);
      return tx
        .delete(auditEvents)
        .where(and(eq(auditEvents.organisationId, org.id), lt(auditEvents.occurredAt, cutoff)))
        .returning({ id: auditEvents.id });
    });
    purged += deleted.length;
  }
  return { organisations: orgs.length, purged };
}
