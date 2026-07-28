import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  integrationConnectionStates,
  integrationSyncWrites,
  type IntegrationSyncWrite,
} from "@/db/schema";
import { newId } from "@/lib/utils";
import { redactDiagnosticObject, redactDiagnosticMessage } from "./redact";
import { canOutboundWrite, getOrCreateSyncPolicy, parseFieldPolicies } from "./sync-policy";
import type {
  ConnectionKind,
  HealthErrorCategory,
  SyncField,
  SyncWriteStatus,
} from "./types";

export class OutboundWriteDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboundWriteDeniedError";
  }
}

/**
 * Begin (or return existing) an outbound write with a stable idempotency key.
 * Retries reuse the same key and append lineage via parent/root write ids.
 */
export async function beginOutboundWrite(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  caseId?: string | null;
  fieldName: SyncField | string;
  idempotencyKey: string;
  requestSummary?: Record<string, unknown>;
  requiredScope: string;
  parentWriteId?: string | null;
}): Promise<{ write: IntegrationSyncWrite; reused: boolean }> {
  const [existing] = await db
    .select()
    .from(integrationSyncWrites)
    .where(
      and(
        eq(integrationSyncWrites.organisationId, opts.organisationId),
        eq(integrationSyncWrites.idempotencyKey, opts.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    // Successful writes are pure no-ops on retry; failed ones can be re-attempted
    // via retryOutboundWrite which creates a child row with a new key suffix.
    return { write: existing, reused: true };
  }

  await assertOutboundAllowed({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
    fieldName: opts.fieldName,
    requiredScope: opts.requiredScope,
  });

  let attempt = 1;
  let rootWriteId: string | null = null;
  if (opts.parentWriteId) {
    const [parent] = await db
      .select()
      .from(integrationSyncWrites)
      .where(
        and(
          eq(integrationSyncWrites.id, opts.parentWriteId),
          eq(integrationSyncWrites.organisationId, opts.organisationId),
        ),
      )
      .limit(1);
    if (parent) {
      attempt = parent.attempt + 1;
      rootWriteId = parent.rootWriteId ?? parent.id;
    }
  }

  const id = newId("intwrite");
  const [inserted] = await db
    .insert(integrationSyncWrites)
    .values({
      id,
      organisationId: opts.organisationId,
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
      caseId: opts.caseId ?? null,
      fieldName: opts.fieldName,
      direction: "outbound",
      idempotencyKey: opts.idempotencyKey,
      requestSummary: redactDiagnosticObject(opts.requestSummary ?? {}),
      status: "pending",
      attempt,
      parentWriteId: opts.parentWriteId ?? null,
      rootWriteId: rootWriteId ?? id,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted) {
    const [race] = await db
      .select()
      .from(integrationSyncWrites)
      .where(
        and(
          eq(integrationSyncWrites.organisationId, opts.organisationId),
          eq(integrationSyncWrites.idempotencyKey, opts.idempotencyKey),
        ),
      )
      .limit(1);
    if (!race) throw new Error("Could not begin outbound write");
    return { write: race, reused: true };
  }
  return { write: inserted, reused: false };
}

export async function completeOutboundWrite(opts: {
  organisationId: string;
  writeId: string;
  status: Extract<SyncWriteStatus, "succeeded" | "failed">;
  providerRequestId?: string | null;
  responseSummary?: Record<string, unknown>;
  sourceVersion?: string | null;
  errorCategory?: HealthErrorCategory | null;
  errorSummary?: string | null;
}): Promise<IntegrationSyncWrite> {
  const [existing] = await db
    .select()
    .from(integrationSyncWrites)
    .where(
      and(
        eq(integrationSyncWrites.id, opts.writeId),
        eq(integrationSyncWrites.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Write not found");
  // Idempotent completion: a finished write is never rewritten.
  if (existing.status === "succeeded" || existing.status === "failed") {
    return existing;
  }
  const [updated] = await db
    .update(integrationSyncWrites)
    .set({
      status: opts.status,
      providerRequestId: opts.providerRequestId ?? existing.providerRequestId,
      responseSummary: redactDiagnosticObject(
        opts.responseSummary ??
          ((existing.responseSummary as Record<string, unknown> | null) ?? {}),
      ),
      sourceVersion: opts.sourceVersion ?? existing.sourceVersion,
      lastErrorCategory:
        opts.status === "failed"
          ? (opts.errorCategory ?? "provider_error")
          : null,
      lastErrorSummary:
        opts.status === "failed"
          ? redactDiagnosticMessage(opts.errorSummary)
          : null,
      finishedAt: new Date(),
    })
    .where(eq(integrationSyncWrites.id, existing.id))
    .returning();
  return updated!;
}

/**
 * Create a child retry write with a new idempotency key derived from the
 * parent. Prior history rows stay immutable.
 */
export async function retryOutboundWrite(opts: {
  organisationId: string;
  parentWriteId: string;
  requiredScope: string;
}): Promise<IntegrationSyncWrite> {
  const [parent] = await db
    .select()
    .from(integrationSyncWrites)
    .where(
      and(
        eq(integrationSyncWrites.id, opts.parentWriteId),
        eq(integrationSyncWrites.organisationId, opts.organisationId),
      ),
    )
    .limit(1);
  if (!parent) throw new Error("Parent write not found");
  if (parent.status === "succeeded") {
    throw new Error("Cannot retry a successful write");
  }
  if (parent.status === "pending" || parent.status === "retrying") {
    throw new Error("Write is already in flight");
  }

  await db
    .update(integrationSyncWrites)
    .set({ status: "retrying" })
    .where(eq(integrationSyncWrites.id, parent.id));

  const childKey = `${parent.idempotencyKey}:retry:${parent.attempt + 1}`;
  const { write } = await beginOutboundWrite({
    organisationId: opts.organisationId,
    connectionKind: parent.connectionKind as ConnectionKind,
    connectionId: parent.connectionId,
    caseId: parent.caseId,
    fieldName: parent.fieldName,
    idempotencyKey: childKey,
    requestSummary: (parent.requestSummary as Record<string, unknown>) ?? {},
    requiredScope: opts.requiredScope,
    parentWriteId: parent.id,
  });
  return write;
}

export async function getWriteByIdempotencyKey(
  organisationId: string,
  idempotencyKey: string,
): Promise<IntegrationSyncWrite | null> {
  const [row] = await db
    .select()
    .from(integrationSyncWrites)
    .where(
      and(
        eq(integrationSyncWrites.organisationId, organisationId),
        eq(integrationSyncWrites.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function assertOutboundAllowed(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  fieldName: string;
  requiredScope: string;
}): Promise<void> {
  const policy = await getOrCreateSyncPolicy({
    organisationId: opts.organisationId,
    connectionKind: opts.connectionKind,
    connectionId: opts.connectionId,
  });
  const [state] = await db
    .select()
    .from(integrationConnectionStates)
    .where(
      and(
        eq(integrationConnectionStates.organisationId, opts.organisationId),
        eq(integrationConnectionStates.connectionKind, opts.connectionKind),
        eq(integrationConnectionStates.connectionId, opts.connectionId),
      ),
    )
    .limit(1);

  const policies = parseFieldPolicies(policy.fieldPolicies);
  const ownership = policies[opts.fieldName as SyncField] ?? "kelpie_owned";
  const scopes = Array.isArray(policy.outboundScopes)
    ? (policy.outboundScopes as string[])
    : [];

  if (
    !canOutboundWrite({
      outboundEnabled: policy.outboundEnabled,
      writeEnabledOnConnection: state?.writeEnabled ?? false,
      outboundScopes: scopes,
      requiredScope: opts.requiredScope,
      ownership,
    })
  ) {
    throw new OutboundWriteDeniedError(
      "Outbound write access is disabled by default and requires explicit scopes plus per-field policy",
    );
  }
}
