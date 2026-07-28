import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationConnectionStates,
  type IntegrationConnectionState,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { redactDiagnosticMessage, redactDiagnosticObject } from "./redact";
import type {
  ConnectionKind,
  HealthErrorCategory,
  HealthStatus,
} from "./types";

export async function getConnectionState(
  organisationId: string,
  connectionKind: ConnectionKind,
  connectionId: string,
): Promise<IntegrationConnectionState | null> {
  const [row] = await db
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
  return row ?? null;
}

export async function ensureConnectionState(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  displayName?: string;
}): Promise<IntegrationConnectionState> {
  const existing = await getConnectionState(
    opts.organisationId,
    opts.connectionKind,
    opts.connectionId,
  );
  if (existing) {
    if (opts.displayName && opts.displayName !== existing.displayName) {
      const [updated] = await db
        .update(integrationConnectionStates)
        .set({ displayName: opts.displayName, updatedAt: new Date() })
        .where(eq(integrationConnectionStates.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }
  const [inserted] = await db
    .insert(integrationConnectionStates)
    .values({
      id: newId("intstate"),
      organisationId: opts.organisationId,
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
      displayName: opts.displayName ?? "",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const again = await getConnectionState(
    opts.organisationId,
    opts.connectionKind,
    opts.connectionId,
  );
  if (!again) throw new Error("Could not ensure connection state");
  return again;
}

export type ConnectionHealthUpdate = {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  displayName?: string;
  status?: HealthStatus;
  errorCategory?: HealthErrorCategory | null;
  errorSummary?: string | null;
  lastAttemptAt?: Date | null;
  lastSuccessAt?: Date | null;
  rateLimitRemaining?: number | null;
  rateLimitResetAt?: Date | null;
  queueDepth?: number | null;
  pollingLagSeconds?: number | null;
  webhookSubscriptionExpiresAt?: Date | null;
  backfillState?: string;
  lastSourceCursor?: string | null;
  readPermissionOk?: boolean | null;
  writePermissionOk?: boolean | null;
  writeEnabled?: boolean;
  metadata?: Record<string, unknown>;
};

/** Upsert health fields after a poll, delivery, or test. Never stores secrets. */
export async function recordConnectionHealth(
  update: ConnectionHealthUpdate,
): Promise<IntegrationConnectionState> {
  const state = await ensureConnectionState({
    organisationId: update.organisationId,
    connectionKind: update.connectionKind,
    connectionId: update.connectionId,
    displayName: update.displayName,
  });

  const set: Partial<typeof integrationConnectionStates.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (update.displayName !== undefined) set.displayName = update.displayName;
  if (update.status !== undefined) set.status = update.status;
  if (update.errorCategory !== undefined) {
    set.errorCategory = update.errorCategory;
  }
  if (update.errorSummary !== undefined) {
    set.errorSummary = redactDiagnosticMessage(update.errorSummary);
  }
  if (update.lastAttemptAt !== undefined) set.lastAttemptAt = update.lastAttemptAt;
  if (update.lastSuccessAt !== undefined) set.lastSuccessAt = update.lastSuccessAt;
  if (update.rateLimitRemaining !== undefined) {
    set.rateLimitRemaining = update.rateLimitRemaining;
  }
  if (update.rateLimitResetAt !== undefined) {
    set.rateLimitResetAt = update.rateLimitResetAt;
  }
  if (update.queueDepth !== undefined) set.queueDepth = update.queueDepth;
  if (update.pollingLagSeconds !== undefined) {
    set.pollingLagSeconds = update.pollingLagSeconds;
  }
  if (update.webhookSubscriptionExpiresAt !== undefined) {
    set.webhookSubscriptionExpiresAt = update.webhookSubscriptionExpiresAt;
  }
  if (update.backfillState !== undefined) set.backfillState = update.backfillState;
  if (update.lastSourceCursor !== undefined) {
    set.lastSourceCursor = update.lastSourceCursor;
  }
  if (update.readPermissionOk !== undefined) {
    set.readPermissionOk = update.readPermissionOk;
  }
  if (update.writePermissionOk !== undefined) {
    set.writePermissionOk = update.writePermissionOk;
  }
  if (update.writeEnabled !== undefined) set.writeEnabled = update.writeEnabled;
  if (update.metadata !== undefined) {
    set.metadata = redactDiagnosticObject(update.metadata);
  }

  // Preserve paused status unless the caller explicitly sets a status.
  if (state.isPaused && update.status === undefined) {
    set.status = "paused";
  } else if (state.isPaused && update.status && update.status !== "paused") {
    // Still paused — do not let a background poll flip status away from paused.
    set.status = "paused";
  }

  const [updated] = await db
    .update(integrationConnectionStates)
    .set(set)
    .where(eq(integrationConnectionStates.id, state.id))
    .returning();
  return updated ?? state;
}

export async function listConnectionStates(
  organisationId: string,
): Promise<IntegrationConnectionState[]> {
  return db
    .select()
    .from(integrationConnectionStates)
    .where(eq(integrationConnectionStates.organisationId, organisationId));
}

export async function setConnectionPaused(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  paused: boolean;
  actorId: string | null;
  displayName?: string;
}): Promise<IntegrationConnectionState> {
  const state = await ensureConnectionState({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    displayName: opts.displayName,
  });
  const now = new Date();
  const [updated] = await db
    .update(integrationConnectionStates)
    .set({
      isPaused: opts.paused,
      pausedAt: opts.paused ? now : null,
      pausedBy: opts.paused ? opts.actorId : null,
      status: opts.paused ? "paused" : state.lastSuccessAt ? "healthy" : "unknown",
      errorCategory: opts.paused ? "paused" : null,
      errorSummary: opts.paused ? "Connection paused by administrator" : null,
      updatedAt: now,
    })
    .where(
      and(
        eq(integrationConnectionStates.id, state.id),
        eq(integrationConnectionStates.organisationId, opts.organisationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Connection not found");
  return updated;
}

export async function recordConnectionTest(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  ok: boolean;
  errorCategory?: HealthErrorCategory | null;
  errorSummary?: string | null;
  displayName?: string;
}): Promise<IntegrationConnectionState> {
  const state = await ensureConnectionState({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    displayName: opts.displayName,
  });
  const now = new Date();
  const [updated] = await db
    .update(integrationConnectionStates)
    .set({
      lastTestAt: now,
      lastTestResult: opts.ok ? "ok" : "failed",
      lastTestErrorCategory: opts.ok ? null : (opts.errorCategory ?? "unknown"),
      lastTestErrorSummary: opts.ok
        ? null
        : redactDiagnosticMessage(opts.errorSummary),
      lastAttemptAt: now,
      lastSuccessAt: opts.ok ? now : state.lastSuccessAt,
      status: state.isPaused
        ? "paused"
        : opts.ok
          ? "healthy"
          : "unhealthy",
      errorCategory: state.isPaused
        ? "paused"
        : opts.ok
          ? null
          : (opts.errorCategory ?? "unknown"),
      errorSummary: state.isPaused
        ? "Connection paused by administrator"
        : opts.ok
          ? null
          : redactDiagnosticMessage(opts.errorSummary),
      readPermissionOk: opts.ok ? true : state.readPermissionOk,
      updatedAt: now,
    })
    .where(
      and(
        eq(integrationConnectionStates.id, state.id),
        eq(integrationConnectionStates.organisationId, opts.organisationId),
      ),
    )
    .returning();
  if (!updated) throw new Error("Connection not found");
  return updated;
}

/** Bump open-conflict count cache in metadata (best-effort). */
export async function setOpenConflictCount(
  organisationId: string,
  connectionKind: ConnectionKind,
  connectionId: string,
  count: number,
): Promise<void> {
  const state = await ensureConnectionState({
    organisationId,
    connectionKind,
    connectionId,
  });
  const metadata = {
    ...((state.metadata as Record<string, unknown> | null) ?? {}),
    openConflictCount: count,
  };
  await db
    .update(integrationConnectionStates)
    .set({
      metadata: redactDiagnosticObject(metadata),
      status:
        count > 0 && !state.isPaused
          ? "conflicting"
          : state.isPaused
            ? "paused"
            : state.status === "conflicting"
              ? state.lastSuccessAt
                ? "healthy"
                : "unknown"
              : state.status,
      errorCategory: count > 0 && !state.isPaused ? "conflict" : state.errorCategory,
      updatedAt: new Date(),
    })
    .where(eq(integrationConnectionStates.id, state.id));
}

export async function touchConnectionSuccess(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  displayName?: string;
  cursor?: string | null;
  pollingLagSeconds?: number | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await recordConnectionHealth({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    displayName: opts.displayName,
    status: "healthy",
    errorCategory: null,
    errorSummary: null,
    lastAttemptAt: new Date(),
    lastSuccessAt: new Date(),
    lastSourceCursor: opts.cursor ?? undefined,
    pollingLagSeconds: opts.pollingLagSeconds ?? undefined,
    readPermissionOk: true,
    metadata: opts.metadata,
  });
}

export async function touchConnectionFailure(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  displayName?: string;
  errorCategory: HealthErrorCategory;
  errorSummary: string;
  rateLimitRemaining?: number | null;
  rateLimitResetAt?: Date | null;
}): Promise<void> {
  const status: HealthStatus =
    opts.errorCategory === "rate_limit"
      ? "rate_limited"
      : opts.errorCategory === "credential_expired" ||
          opts.errorCategory === "subscription_expired"
        ? "expired"
        : "unhealthy";
  await recordConnectionHealth({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    displayName: opts.displayName,
    status,
    errorCategory: opts.errorCategory,
    errorSummary: opts.errorSummary,
    lastAttemptAt: new Date(),
    rateLimitRemaining: opts.rateLimitRemaining,
    rateLimitResetAt: opts.rateLimitResetAt,
  });
}

// silence unused sql import if tree-shaken elsewhere
void sql;
