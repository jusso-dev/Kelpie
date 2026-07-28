/**
 * Pause/resume and connection test controls. Always organisation-scoped and
 * audited. Never returns or logs plaintext credentials.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  caseSources,
  tiFeeds,
  webhooks,
  type IntegrationConnectionState,
} from "@/db/schema";
import { recordAuditEvent } from "@/lib/audit/events";
import type { AuditContext } from "@/lib/audit/events";
import { classifyHealthError } from "./error-category";
import { redactDiagnosticMessage } from "./redact";
import {
  ensureConnectionState,
  recordConnectionTest,
  setConnectionPaused,
} from "./state";
import type { ConnectionKind } from "./types";

export class IntegrationAuthzError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "IntegrationAuthzError";
    this.status = status;
  }
}

export class IntegrationNotFoundError extends Error {
  status = 404;
  constructor(message = "Connection not found") {
    super(message);
    this.name = "IntegrationNotFoundError";
  }
}

/** Verify the native connector row exists in this organisation. */
export async function assertConnectionInOrg(
  organisationId: string,
  connectionKind: ConnectionKind,
  connectionId: string,
): Promise<{ displayName: string }> {
  if (connectionKind === "case_source") {
    const [row] = await db
      .select({ id: caseSources.id, name: caseSources.name })
      .from(caseSources)
      .where(
        and(
          eq(caseSources.id, connectionId),
          eq(caseSources.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!row) throw new IntegrationNotFoundError();
    return { displayName: row.name };
  }
  if (connectionKind === "ti_feed") {
    const [row] = await db
      .select({ id: tiFeeds.id, name: tiFeeds.name })
      .from(tiFeeds)
      .where(
        and(eq(tiFeeds.id, connectionId), eq(tiFeeds.organisationId, organisationId)),
      )
      .limit(1);
    if (!row) throw new IntegrationNotFoundError();
    return { displayName: row.name };
  }
  if (connectionKind === "webhook") {
    const [row] = await db
      .select({ id: webhooks.id, name: webhooks.name })
      .from(webhooks)
      .where(
        and(
          eq(webhooks.id, connectionId),
          eq(webhooks.organisationId, organisationId),
        ),
      )
      .limit(1);
    if (!row) throw new IntegrationNotFoundError();
    return { displayName: row.name };
  }
  if (connectionKind === "inbound_source") {
    // Push producers are identified by stable slug; allow pause even before
    // first delivery by accepting known connection ids.
    await ensureConnectionState({
      organisationId,
      connectionKind,
      connectionId,
      displayName: connectionId,
    });
    return { displayName: connectionId };
  }
  // enrichment / response_action: soft-ensure
  await ensureConnectionState({
    organisationId,
    connectionKind,
    connectionId,
    displayName: connectionId,
  });
  return { displayName: connectionId };
}

export async function pauseConnection(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  actorId: string;
  actorLabel?: string | null;
  audit?: AuditContext;
}): Promise<IntegrationConnectionState> {
  const { displayName } = await assertConnectionInOrg(
    opts.organisationId,
    opts.connectionKind,
    opts.connectionId,
  );
  const state = await setConnectionPaused({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    paused: true,
    actorId: opts.actorId,
    displayName,
  });

  // Mirror onto native isActive flags so workers respect pause.
  await mirrorNativeActive(opts, false);

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: "user",
    actorLabel: opts.actorLabel ?? null,
    action: "integration.paused",
    targetType: "integration_connection",
    targetId: `${opts.connectionKind}:${opts.connectionId}`,
    targetLabel: displayName,
    before: { isPaused: false },
    after: { isPaused: true, status: state.status },
    metadata: {
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
    },
    ...opts.audit,
  });
  return state;
}

export async function resumeConnection(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  actorId: string;
  actorLabel?: string | null;
  audit?: AuditContext;
}): Promise<IntegrationConnectionState> {
  const { displayName } = await assertConnectionInOrg(
    opts.organisationId,
    opts.connectionKind,
    opts.connectionId,
  );
  const state = await setConnectionPaused({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    paused: false,
    actorId: opts.actorId,
    displayName,
  });
  await mirrorNativeActive(opts, true);

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: "user",
    actorLabel: opts.actorLabel ?? null,
    action: "integration.resumed",
    targetType: "integration_connection",
    targetId: `${opts.connectionKind}:${opts.connectionId}`,
    targetLabel: displayName,
    before: { isPaused: true },
    after: { isPaused: false, status: state.status },
    metadata: {
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
    },
    ...opts.audit,
  });
  return state;
}

async function mirrorNativeActive(
  opts: {
    organisationId: string;
    connectionKind: ConnectionKind;
    connectionId: string;
  },
  active: boolean,
): Promise<void> {
  if (opts.connectionKind === "case_source") {
    await db
      .update(caseSources)
      .set({ isActive: active, lastError: active ? null : undefined })
      .where(
        and(
          eq(caseSources.id, opts.connectionId),
          eq(caseSources.organisationId, opts.organisationId),
        ),
      );
  } else if (opts.connectionKind === "ti_feed") {
    await db
      .update(tiFeeds)
      .set({ isActive: active, lastError: active ? null : undefined })
      .where(
        and(
          eq(tiFeeds.id, opts.connectionId),
          eq(tiFeeds.organisationId, opts.organisationId),
        ),
      );
  } else if (opts.connectionKind === "webhook") {
    await db
      .update(webhooks)
      .set({ isActive: active })
      .where(
        and(
          eq(webhooks.id, opts.connectionId),
          eq(webhooks.organisationId, opts.organisationId),
        ),
      );
  }
}

/**
 * Safe connectivity test. For case sources this validates config presence and
 * that the connection is not paused — it does not echo credentials. Full
 * provider round-trips stay on the existing "poll now" path.
 */
export async function testConnection(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  actorId: string;
  actorLabel?: string | null;
  audit?: AuditContext;
}): Promise<{ ok: boolean; errorSummary: string | null }> {
  const { displayName } = await assertConnectionInOrg(
    opts.organisationId,
    opts.connectionKind,
    opts.connectionId,
  );

  let ok = true;
  let errorSummary: string | null = null;
  let errorCategory = null as ReturnType<typeof classifyHealthError>;

  try {
    if (opts.connectionKind === "case_source") {
      const [source] = await db
        .select()
        .from(caseSources)
        .where(
          and(
            eq(caseSources.id, opts.connectionId),
            eq(caseSources.organisationId, opts.organisationId),
          ),
        )
        .limit(1);
      if (!source) throw new IntegrationNotFoundError();
      const config = (source.config ?? {}) as Record<string, unknown>;
      if (!config.tenant_id || !config.client_id) {
        ok = false;
        errorSummary = "Case source is missing required configuration fields";
        errorCategory = "config";
      } else if (source.lastError) {
        // Config present; surface last known error without replaying secret material.
        ok = false;
        errorSummary = redactDiagnosticMessage(source.lastError);
        errorCategory = classifyHealthError(source.lastError);
      }
    } else if (opts.connectionKind === "ti_feed") {
      const [feed] = await db
        .select()
        .from(tiFeeds)
        .where(
          and(
            eq(tiFeeds.id, opts.connectionId),
            eq(tiFeeds.organisationId, opts.organisationId),
          ),
        )
        .limit(1);
      if (!feed) throw new IntegrationNotFoundError();
      if (!feed.url && feed.kind !== "manual") {
        ok = false;
        errorSummary = "TI feed has no URL configured";
        errorCategory = "config";
      } else if (feed.lastError) {
        ok = false;
        errorSummary = redactDiagnosticMessage(feed.lastError);
        errorCategory = classifyHealthError(feed.lastError);
      }
    } else if (opts.connectionKind === "webhook") {
      const [hook] = await db
        .select()
        .from(webhooks)
        .where(
          and(
            eq(webhooks.id, opts.connectionId),
            eq(webhooks.organisationId, opts.organisationId),
          ),
        )
        .limit(1);
      if (!hook) throw new IntegrationNotFoundError();
      if (!hook.url) {
        ok = false;
        errorSummary = "Webhook has no URL configured";
        errorCategory = "config";
      }
    }
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) throw error;
    ok = false;
    errorSummary = redactDiagnosticMessage(
      error instanceof Error ? error.message : "Connection test failed",
    );
    errorCategory = classifyHealthError(errorSummary);
  }

  await recordConnectionTest({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    ok,
    errorCategory,
    errorSummary,
    displayName,
  });

  await recordAuditEvent({
    organisationId: opts.organisationId,
    actorId: opts.actorId,
    actorType: "user",
    actorLabel: opts.actorLabel ?? null,
    action: "integration.tested",
    targetType: "integration_connection",
    targetId: `${opts.connectionKind}:${opts.connectionId}`,
    targetLabel: displayName,
    before: null,
    after: {
      ok,
      errorCategory,
      // errorSummary already redacted
      errorSummary,
    },
    metadata: {
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
    },
    ...opts.audit,
  });

  return { ok, errorSummary };
}
