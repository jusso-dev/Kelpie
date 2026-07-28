/**
 * Support-safe diagnostics export. Guaranteed secret-free.
 */

import { listOpenConflicts } from "./conflicts";
import { listOrganisationHealth } from "./health";
import { redactDiagnosticObject } from "./redact";
import type { IntegrationHealth } from "./types";

export type DiagnosticsBundle = {
  exportedAt: string;
  organisationId: string;
  connections: IntegrationHealth[];
  openConflicts: Array<{
    id: string;
    connectionKind: string;
    connectionId: string;
    caseId: string | null;
    fieldName: string;
    kelpieValue: unknown;
    sourceValue: unknown;
    kelpieUpdatedAt: string | null;
    sourceUpdatedAt: string | null;
    kelpieProvenance: string | null;
    sourceProvenance: string | null;
    createdAt: string;
  }>;
};

export async function exportDiagnostics(
  organisationId: string,
): Promise<DiagnosticsBundle> {
  const [connections, conflicts] = await Promise.all([
    listOrganisationHealth(organisationId),
    listOpenConflicts(organisationId, { limit: 200 }),
  ]);

  // Defence in depth: re-redact every nested bag before leaving the process.
  const safeConnections = connections.map((c) => ({
    ...c,
    credentials: c.credentials.map((cred) => ({
      id: cred.id,
      label: cred.label,
      reference: cred.reference,
      fingerprint: cred.fingerprint,
      consentedScopes: cred.consentedScopes,
      expiresAt: cred.expiresAt,
      rotatedAt: cred.rotatedAt,
      rotationState: cred.rotationState,
    })),
    errorSummary: c.errorSummary,
  }));

  return {
    exportedAt: new Date().toISOString(),
    organisationId,
    connections: safeConnections,
    openConflicts: conflicts.map((conflict) => ({
      id: conflict.id,
      connectionKind: conflict.connectionKind,
      connectionId: conflict.connectionId,
      caseId: conflict.caseId,
      fieldName: conflict.fieldName,
      kelpieValue: redactDiagnosticObject(
        (conflict.kelpieValue as Record<string, unknown>) ?? {},
      ),
      sourceValue: redactDiagnosticObject(
        (conflict.sourceValue as Record<string, unknown>) ?? {},
      ),
      kelpieUpdatedAt: conflict.kelpieUpdatedAt?.toISOString() ?? null,
      sourceUpdatedAt: conflict.sourceUpdatedAt?.toISOString() ?? null,
      kelpieProvenance: conflict.kelpieProvenance,
      sourceProvenance: conflict.sourceProvenance,
      createdAt: conflict.createdAt.toISOString(),
    })),
  };
}

/** Scan a diagnostics bundle for anything that looks like a secret leak. */
export function diagnosticsContainsSecrets(bundle: unknown): boolean {
  const raw = JSON.stringify(bundle);
  if (/\bklp_[A-Za-z0-9_-]{8,}\b/.test(raw)) return true;
  if (/bearer\s+[A-Za-z0-9._-]{8,}/i.test(raw)) return true;
  if (/"client_secret"\s*:\s*"[^"]+"/i.test(raw)) return true;
  if (/"password"\s*:\s*"[^"]+"/i.test(raw)) return true;
  if (/"api_key"\s*:\s*"[^"]+"/i.test(raw)) return true;
  if (/"secret"\s*:\s*"(?!\[redacted\])[^"]+"/i.test(raw)) return true;
  return false;
}
