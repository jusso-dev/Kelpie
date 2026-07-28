"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { recordAuditEvent } from "@/lib/audit/events";
import { auditContextFromHeaders } from "@/lib/audit/request-context";
import {
  IntegrationNotFoundError,
  pauseConnection,
  resumeConnection,
  testConnection,
} from "@/lib/integrations/control";
import { resolveConflict } from "@/lib/integrations/conflicts";
import { exportDiagnostics } from "@/lib/integrations/diagnostics";
import {
  isConnectionKind,
  isFieldOwnership,
  isSyncField,
  type ConnectionKind,
  type FieldOwnership,
  type SyncField,
} from "@/lib/integrations/types";
import { updateSyncPolicy } from "@/lib/integrations/sync-policy";
import { requireRole } from "@/lib/session";

function parseKind(raw: string): ConnectionKind {
  if (!isConnectionKind(raw)) throw new Error("Unknown connection kind");
  return raw;
}

export async function pauseIntegrationConnection(
  connectionKind: string,
  connectionId: string,
) {
  const user = await requireRole(["admin"]);
  const kind = parseKind(connectionKind);
  try {
    await pauseConnection({
      organisationId: user.organisationId,
      connectionKind: kind,
      connectionId,
      actorId: user.id,
      actorLabel: user.email,
      audit: auditContextFromHeaders(await headers()),
    });
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) throw new Error(error.message);
    throw error;
  }
  revalidatePath("/settings/integrations");
}

export async function resumeIntegrationConnection(
  connectionKind: string,
  connectionId: string,
) {
  const user = await requireRole(["admin"]);
  const kind = parseKind(connectionKind);
  try {
    await resumeConnection({
      organisationId: user.organisationId,
      connectionKind: kind,
      connectionId,
      actorId: user.id,
      actorLabel: user.email,
      audit: auditContextFromHeaders(await headers()),
    });
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) throw new Error(error.message);
    throw error;
  }
  revalidatePath("/settings/integrations");
}

export async function testIntegrationConnection(
  connectionKind: string,
  connectionId: string,
) {
  const user = await requireRole(["admin"]);
  const kind = parseKind(connectionKind);
  try {
    const result = await testConnection({
      organisationId: user.organisationId,
      connectionKind: kind,
      connectionId,
      actorId: user.id,
      actorLabel: user.email,
      audit: auditContextFromHeaders(await headers()),
    });
    revalidatePath("/settings/integrations");
    return result;
  } catch (error) {
    if (error instanceof IntegrationNotFoundError) throw new Error(error.message);
    throw error;
  }
}

export async function resolveIntegrationConflict(
  conflictId: string,
  resolution: "resolved_keep_kelpie" | "resolved_take_source" | "dismissed",
) {
  const user = await requireRole(["admin", "analyst"]);
  if (
    resolution !== "resolved_keep_kelpie" &&
    resolution !== "resolved_take_source" &&
    resolution !== "dismissed"
  ) {
    throw new Error("Invalid conflict resolution");
  }
  const conflict = await resolveConflict({
    organisationId: user.organisationId,
    conflictId,
    resolution,
    actorId: user.id,
  });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "integration.conflict_resolved",
    targetType: "integration_sync_conflict",
    targetId: conflictId,
    targetLabel: conflict.fieldName,
    before: { status: "open" },
    after: { status: resolution },
    metadata: {
      caseId: conflict.caseId,
      fieldName: conflict.fieldName,
    },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/integrations");
  if (conflict.caseId) revalidatePath(`/cases/${conflict.caseId}`);
  return { id: conflict.id, status: conflict.status };
}

export async function updateIntegrationSyncPolicy(input: {
  connectionKind: string;
  connectionId: string;
  fieldPolicies?: Record<string, string>;
  outboundEnabled?: boolean;
  outboundScopes?: string[];
  freshnessThresholdMinutes?: number;
}) {
  const user = await requireRole(["admin"]);
  const kind = parseKind(input.connectionKind);
  const fieldPolicies: Partial<Record<SyncField, FieldOwnership>> = {};
  if (input.fieldPolicies) {
    for (const [k, v] of Object.entries(input.fieldPolicies)) {
      if (!isSyncField(k) || !isFieldOwnership(v)) {
        throw new Error(`Invalid field policy: ${k}=${v}`);
      }
      fieldPolicies[k] = v;
    }
  }
  const policy = await updateSyncPolicy({
    organisationId: user.organisationId,
    connectionKind: kind,
    connectionId: input.connectionId,
    fieldPolicies,
    outboundEnabled: input.outboundEnabled,
    outboundScopes: input.outboundScopes,
    freshnessThresholdMinutes: input.freshnessThresholdMinutes,
  });
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "integration.sync_policy_updated",
    targetType: "integration_sync_policy",
    targetId: policy.id,
    targetLabel: `${kind}:${input.connectionId}`,
    before: null,
    after: {
      outboundEnabled: policy.outboundEnabled,
      freshnessThresholdMinutes: policy.freshnessThresholdMinutes,
      fieldPolicies: policy.fieldPolicies,
    },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/integrations");
  return { id: policy.id };
}

export async function exportIntegrationDiagnostics() {
  const user = await requireRole(["admin"]);
  const bundle = await exportDiagnostics(user.organisationId);
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "integration.diagnostics_exported",
    targetType: "organisation",
    targetId: user.organisationId,
    targetLabel: "integration diagnostics",
    before: null,
    after: {
      connectionCount: bundle.connections.length,
      openConflictCount: bundle.openConflicts.length,
    },
    ...auditContextFromHeaders(await headers()),
  });
  return bundle;
}
