/**
 * Assemble the typed, secret-free health contract for every connection kind.
 */

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseSources,
  cases,
  inboundSourceStatus,
  integrationConnectionStates,
  integrationSyncConflicts,
  integrationSyncPolicies,
  tiFeeds,
  webhooks,
  type IntegrationConnectionState,
} from "@/db/schema";
import { listCredentialsForConnection, credentialWarnings } from "./credentials";
import { classifyHealthError } from "./error-category";
import { redactDiagnosticMessage } from "./redact";
import { ensureConnectionState } from "./state";
import { getOrCreateSyncPolicy, parseFieldPolicies } from "./sync-policy";
import {
  CREDENTIAL_EXPIRY_WARNING_MS,
  DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
  type ConnectionKind,
  type HealthErrorCategory,
  type HealthStatus,
  type IntegrationHealth,
  type IntegrationWarning,
} from "./types";

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function isStale(
  lastSuccessAt: Date | null | undefined,
  thresholdMinutes: number,
  now = new Date(),
): boolean {
  if (!lastSuccessAt) return true;
  return now.getTime() - lastSuccessAt.getTime() > thresholdMinutes * 60_000;
}

export function buildWarnings(opts: {
  state: IntegrationConnectionState;
  credentials: Awaited<ReturnType<typeof listCredentialsForConnection>>;
  openConflictCount: number;
  thresholdMinutes: number;
  now?: Date;
}): IntegrationWarning[] {
  const now = opts.now ?? new Date();
  const warnings: IntegrationWarning[] = [
    ...credentialWarnings(opts.credentials),
  ];

  if (opts.state.isPaused) {
    warnings.push({
      code: "paused",
      message: "Connection is paused; polling and outbound writes are held.",
      severity: "info",
    });
  }

  if (opts.state.rateLimitRemaining === 0 || opts.state.status === "rate_limited") {
    warnings.push({
      code: "rate_limited",
      message: "Provider rate limit is active.",
      severity: "warning",
    });
  }

  if (
    opts.state.webhookSubscriptionExpiresAt &&
    opts.state.webhookSubscriptionExpiresAt.getTime() <= now.getTime()
  ) {
    warnings.push({
      code: "subscription_expired",
      message: "Webhook/subscription has expired and must be renewed.",
      severity: "critical",
    });
  } else if (
    opts.state.webhookSubscriptionExpiresAt &&
    opts.state.webhookSubscriptionExpiresAt.getTime() - now.getTime() <=
      CREDENTIAL_EXPIRY_WARNING_MS
  ) {
    warnings.push({
      code: "subscription_expiring",
      message: `Webhook/subscription expires at ${opts.state.webhookSubscriptionExpiresAt.toISOString()}.`,
      severity: "warning",
    });
  }

  if (
    isStale(opts.state.lastSuccessAt, opts.thresholdMinutes, now) &&
    !opts.state.isPaused
  ) {
    warnings.push({
      code: "stale_cursor",
      message: `No successful operation within the ${opts.thresholdMinutes}-minute freshness window.`,
      severity: "warning",
    });
  }

  if (opts.openConflictCount > 0) {
    warnings.push({
      code: "open_conflicts",
      message: `${opts.openConflictCount} open sync conflict(s) need review.`,
      severity: "warning",
    });
  }

  if (!opts.state.writeEnabled) {
    warnings.push({
      code: "write_disabled",
      message: "Outbound write access is disabled (default).",
      severity: "info",
    });
  }

  return warnings;
}

export function toHealthView(
  state: IntegrationConnectionState,
  extras: {
    credentials: Awaited<ReturnType<typeof listCredentialsForConnection>>;
    openConflictCount: number;
    outboundEnabled: boolean;
    freshnessThresholdMinutes: number;
  },
  now = new Date(),
): IntegrationHealth {
  const warnings = buildWarnings({
    state,
    credentials: extras.credentials,
    openConflictCount: extras.openConflictCount,
    thresholdMinutes: extras.freshnessThresholdMinutes,
    now,
  });
  const stale = isStale(
    state.lastSuccessAt,
    extras.freshnessThresholdMinutes,
    now,
  );
  return {
    connectionKind: state.connectionKind as ConnectionKind,
    connectionId: state.connectionId,
    displayName: state.displayName,
    status: state.status as HealthStatus,
    errorCategory: (state.errorCategory as HealthErrorCategory | null) ?? null,
    errorSummary: redactDiagnosticMessage(state.errorSummary),
    lastAttemptAt: iso(state.lastAttemptAt),
    lastSuccessAt: iso(state.lastSuccessAt),
    rateLimitRemaining: state.rateLimitRemaining,
    rateLimitResetAt: iso(state.rateLimitResetAt),
    queueDepth: state.queueDepth,
    pollingLagSeconds: state.pollingLagSeconds,
    webhookSubscriptionExpiresAt: iso(state.webhookSubscriptionExpiresAt),
    backfillState: state.backfillState,
    lastSourceCursor: state.lastSourceCursor,
    readPermissionOk: state.readPermissionOk,
    writePermissionOk: state.writePermissionOk,
    writeEnabled: state.writeEnabled,
    isPaused: state.isPaused,
    credentials: extras.credentials,
    warnings,
    openConflictCount: extras.openConflictCount,
    lastTestAt: iso(state.lastTestAt),
    lastTestResult: state.lastTestResult,
    outboundEnabled: extras.outboundEnabled,
    freshnessThresholdMinutes: extras.freshnessThresholdMinutes,
    stale,
  };
}

async function extrasFor(
  organisationId: string,
  connectionKind: ConnectionKind,
  connectionId: string,
) {
  const [credentials, openConflictCount, policy] = await Promise.all([
    listCredentialsForConnection(organisationId, connectionKind, connectionId),
    db
      .select({ n: count() })
      .from(integrationSyncConflicts)
      .where(
        and(
          eq(integrationSyncConflicts.organisationId, organisationId),
          eq(integrationSyncConflicts.connectionKind, connectionKind),
          eq(integrationSyncConflicts.connectionId, connectionId),
          eq(integrationSyncConflicts.status, "open"),
        ),
      )
      .then((rows) => Number(rows[0]?.n ?? 0)),
    getOrCreateSyncPolicy({ organisationId, connectionKind, connectionId }),
  ]);
  return {
    credentials,
    openConflictCount,
    outboundEnabled: policy.outboundEnabled,
    freshnessThresholdMinutes: policy.freshnessThresholdMinutes,
  };
}

export async function getConnectionHealth(
  organisationId: string,
  connectionKind: ConnectionKind,
  connectionId: string,
): Promise<IntegrationHealth | null> {
  const [state] = await db
    .select()
    .from(integrationConnectionStates)
    .where(
      and(
        eq(integrationConnectionStates.organisationId, organisationId),
        eq(integrationConnectionStates.connectionKind, connectionKind),
        eq(integrationConnectionStates.connectionId, connectionId),
      ),
    )
    .limit(1);
  if (!state) return null;
  const extras = await extrasFor(organisationId, connectionKind, connectionId);
  return toHealthView(state, extras);
}

/**
 * Seed / refresh health rows from the native connector tables so admins see
 * every connection even before the first health write.
 */
export async function listOrganisationHealth(
  organisationId: string,
): Promise<IntegrationHealth[]> {
  await seedHealthFromConnectors(organisationId);
  const states = await db
    .select()
    .from(integrationConnectionStates)
    .where(eq(integrationConnectionStates.organisationId, organisationId))
    .orderBy(desc(integrationConnectionStates.updatedAt));

  const results: IntegrationHealth[] = [];
  for (const state of states) {
    const kind = state.connectionKind as ConnectionKind;
    const extras = await extrasFor(organisationId, kind, state.connectionId);
    results.push(toHealthView(state, extras));
  }
  return results;
}

export async function seedHealthFromConnectors(
  organisationId: string,
): Promise<void> {
  const [sources, feeds, hooks, inbound] = await Promise.all([
    db
      .select()
      .from(caseSources)
      .where(eq(caseSources.organisationId, organisationId)),
    db.select().from(tiFeeds).where(eq(tiFeeds.organisationId, organisationId)),
    db
      .select()
      .from(webhooks)
      .where(eq(webhooks.organisationId, organisationId)),
    db
      .select()
      .from(inboundSourceStatus)
      .where(eq(inboundSourceStatus.organisationId, organisationId)),
  ]);

  for (const source of sources) {
    const state = await ensureConnectionState({
      organisationId,
      connectionKind: "case_source",
      connectionId: source.id,
      displayName: source.name,
    });
    // Only backfill timestamps when the health row is still empty.
    if (!state.lastAttemptAt && (source.lastPolledAt || source.lastError)) {
      const category = classifyHealthError(source.lastError);
      await db
        .update(integrationConnectionStates)
        .set({
          lastAttemptAt: source.lastPolledAt,
          lastSuccessAt: source.lastError ? null : source.lastPolledAt,
          lastSourceCursor: source.cursor,
          errorSummary: redactDiagnosticMessage(source.lastError),
          errorCategory: category,
          status: source.isActive
            ? source.lastError
              ? "unhealthy"
              : source.lastPolledAt
                ? "healthy"
                : "unknown"
            : "paused",
          isPaused: !source.isActive || state.isPaused,
          readPermissionOk: source.lastError ? false : state.readPermissionOk,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnectionStates.id, state.id));
    }
  }

  for (const feed of feeds) {
    const state = await ensureConnectionState({
      organisationId,
      connectionKind: "ti_feed",
      connectionId: feed.id,
      displayName: feed.name,
    });
    if (!state.lastAttemptAt && (feed.lastPolledAt || feed.lastError)) {
      const category = classifyHealthError(feed.lastError);
      await db
        .update(integrationConnectionStates)
        .set({
          lastAttemptAt: feed.lastPolledAt,
          lastSuccessAt: feed.lastError ? null : feed.lastPolledAt,
          errorSummary: redactDiagnosticMessage(feed.lastError),
          errorCategory: category,
          status: feed.isActive
            ? feed.lastError
              ? "unhealthy"
              : feed.lastPolledAt
                ? "healthy"
                : "unknown"
            : "paused",
          isPaused: !feed.isActive || state.isPaused,
          updatedAt: new Date(),
        })
        .where(eq(integrationConnectionStates.id, state.id));
    }
  }

  for (const hook of hooks) {
    await ensureConnectionState({
      organisationId,
      connectionKind: "webhook",
      connectionId: hook.id,
      displayName: hook.name,
    });
  }

  for (const row of inbound) {
    const state = await ensureConnectionState({
      organisationId,
      connectionKind: "inbound_source",
      connectionId: row.sourceSystem,
      displayName: row.sourceSystem,
    });
    if (!state.lastAttemptAt) {
      await db
        .update(integrationConnectionStates)
        .set({
          lastAttemptAt: row.lastDeliveryAt ?? row.lastErrorAt,
          lastSuccessAt: row.lastDeliveryAt,
          errorSummary: redactDiagnosticMessage(row.lastErrorMessage),
          errorCategory: row.lastErrorAt
            ? classifyHealthError(row.lastErrorMessage, {
                httpStatus: row.lastErrorStatus,
              })
            : null,
          status: row.lastErrorAt && !row.lastDeliveryAt
            ? "unhealthy"
            : row.lastDeliveryAt
              ? "healthy"
              : "unknown",
          metadata: {
            deliveryCount: row.deliveryCount,
            createdCaseCount: row.createdCaseCount,
            duplicateCount: row.duplicateCount,
            errorCount: row.errorCount,
          },
          updatedAt: new Date(),
        })
        .where(eq(integrationConnectionStates.id, state.id));
    }
  }
}

/**
 * Case-level staleness for analyst banners. Uses the connection's last
 * success + policy freshness threshold; falls back to default threshold.
 */
export async function getCaseStaleness(
  organisationId: string,
  caseId: string,
): Promise<{
  caseId: string;
  sourceSystem: string | null;
  connectionKind: ConnectionKind | null;
  connectionId: string | null;
  stale: boolean;
  lastSuccessAt: string | null;
  freshnessThresholdMinutes: number;
  reason: string | null;
} | null> {
  const [c] = await db
    .select({
      id: cases.id,
      sourceSystem: cases.sourceSystem,
      sourceReference: cases.sourceReference,
    })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!c) return null;
  if (!c.sourceSystem) {
    return {
      caseId: c.id,
      sourceSystem: null,
      connectionKind: null,
      connectionId: null,
      stale: false,
      lastSuccessAt: null,
      freshnessThresholdMinutes: DEFAULT_FRESHNESS_THRESHOLD_MINUTES,
      reason: null,
    };
  }

  // Case sources encode kind:id in sourceSystem for polled connectors.
  let connectionKind: ConnectionKind = "inbound_source";
  let connectionId = c.sourceSystem;
  if (c.sourceSystem.startsWith("microsoft_sentinel:")) {
    connectionKind = "case_source";
    connectionId = c.sourceSystem.slice("microsoft_sentinel:".length);
  } else if (c.sourceSystem.startsWith("microsoft_defender_xdr:")) {
    connectionKind = "case_source";
    connectionId = c.sourceSystem.slice("microsoft_defender_xdr:".length);
  }

  const [state] = await db
    .select()
    .from(integrationConnectionStates)
    .where(
      and(
        eq(integrationConnectionStates.organisationId, organisationId),
        eq(integrationConnectionStates.connectionKind, connectionKind),
        eq(integrationConnectionStates.connectionId, connectionId),
      ),
    )
    .limit(1);

  let threshold = DEFAULT_FRESHNESS_THRESHOLD_MINUTES;
  const [policy] = await db
    .select()
    .from(integrationSyncPolicies)
    .where(
      and(
        eq(integrationSyncPolicies.organisationId, organisationId),
        eq(integrationSyncPolicies.connectionKind, connectionKind),
        eq(integrationSyncPolicies.connectionId, connectionId),
      ),
    )
    .limit(1);
  if (policy) threshold = policy.freshnessThresholdMinutes;

  const lastSuccess = state?.lastSuccessAt ?? null;
  const stale =
    !state?.isPaused &&
    isStale(lastSuccess, threshold) &&
    Boolean(c.sourceSystem);

  return {
    caseId: c.id,
    sourceSystem: c.sourceSystem,
    connectionKind,
    connectionId,
    stale,
    lastSuccessAt: iso(lastSuccess),
    freshnessThresholdMinutes: threshold,
    reason: stale
      ? `Source data may be stale: no successful sync within ${threshold} minutes.`
      : null,
  };
}

// re-export for callers that only need policy parse
export { parseFieldPolicies };
