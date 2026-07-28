import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationCredentials } from "@/db/schema";
import { newId } from "@/lib/utils";
import { credentialFingerprint } from "./redact";
import {
  CREDENTIAL_EXPIRY_WARNING_MS,
  type ConnectionKind,
  type CredentialRotationState,
  type IntegrationCredentialView,
} from "./types";

export function computeRotationState(
  expiresAt: Date | null | undefined,
  now = new Date(),
): CredentialRotationState {
  if (!expiresAt) return "active";
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return "expired";
  if (ms <= CREDENTIAL_EXPIRY_WARNING_MS) return "expiring";
  return "active";
}

/**
 * Upsert a credential *reference* for a connection. Callers pass the secret
 * only long enough to derive a fingerprint; the secret itself is never
 * persisted on this table (connectors may still keep it in their own config
 * until a dedicated vault lands).
 */
export async function upsertCredentialReference(opts: {
  organisationId: string;
  connectionKind: ConnectionKind;
  connectionId: string;
  label: string;
  /** Opaque storage reference (e.g. config path or vault id). */
  reference: string;
  /** Optional secret used solely to derive a short fingerprint. */
  secretForFingerprint?: string | null;
  consentedScopes?: string[];
  expiresAt?: Date | null;
  rotatedAt?: Date | null;
}): Promise<IntegrationCredentialView> {
  const now = new Date();
  const fingerprint = opts.secretForFingerprint
    ? credentialFingerprint(opts.secretForFingerprint)
    : null;
  const rotationState = computeRotationState(opts.expiresAt ?? null, now);
  const [existing] = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.organisationId, opts.organisationId),
        eq(integrationCredentials.connectionKind, opts.connectionKind),
        eq(integrationCredentials.connectionId, opts.connectionId),
        eq(integrationCredentials.label, opts.label),
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(integrationCredentials)
      .set({
        reference: opts.reference,
        fingerprint: fingerprint ?? existing.fingerprint,
        consentedScopes: opts.consentedScopes ?? existing.consentedScopes,
        expiresAt:
          opts.expiresAt === undefined ? existing.expiresAt : opts.expiresAt,
        rotatedAt:
          opts.rotatedAt === undefined
            ? fingerprint && fingerprint !== existing.fingerprint
              ? now
              : existing.rotatedAt
            : opts.rotatedAt,
        rotationState,
        updatedAt: now,
      })
      .where(eq(integrationCredentials.id, existing.id))
      .returning();
    return toCredentialView(updated!);
  }

  const [inserted] = await db
    .insert(integrationCredentials)
    .values({
      id: newId("intcred"),
      organisationId: opts.organisationId,
      connectionKind: opts.connectionKind,
      connectionId: opts.connectionId,
      label: opts.label,
      reference: opts.reference,
      fingerprint,
      consentedScopes: opts.consentedScopes ?? [],
      expiresAt: opts.expiresAt ?? null,
      rotatedAt: opts.rotatedAt ?? null,
      rotationState,
    })
    .returning();
  return toCredentialView(inserted!);
}

export async function listCredentialsForConnection(
  organisationId: string,
  connectionKind: ConnectionKind,
  connectionId: string,
): Promise<IntegrationCredentialView[]> {
  const rows = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.organisationId, organisationId),
        eq(integrationCredentials.connectionKind, connectionKind),
        eq(integrationCredentials.connectionId, connectionId),
      ),
    );
  // Refresh rotation state for display even if nothing else changed.
  const now = new Date();
  return rows.map((row) => {
    const rotationState = computeRotationState(row.expiresAt, now);
    return toCredentialView({ ...row, rotationState });
  });
}

export function toCredentialView(row: {
  id: string;
  label: string;
  reference: string;
  fingerprint: string | null;
  consentedScopes: unknown;
  expiresAt: Date | null;
  rotatedAt: Date | null;
  rotationState: string;
}): IntegrationCredentialView {
  const scopes = Array.isArray(row.consentedScopes)
    ? row.consentedScopes.filter((s): s is string => typeof s === "string")
    : [];
  return {
    id: row.id,
    label: row.label,
    reference: row.reference,
    fingerprint: row.fingerprint,
    consentedScopes: scopes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    rotatedAt: row.rotatedAt?.toISOString() ?? null,
    rotationState: row.rotationState as CredentialRotationState,
  };
}

/** Pure helper used by tests and health assembly — no DB. */
export function credentialWarnings(
  credentials: IntegrationCredentialView[],
): Array<{ code: "credential_expiring" | "credential_expired"; message: string; severity: "warning" | "critical" }> {
  const out: Array<{
    code: "credential_expiring" | "credential_expired";
    message: string;
    severity: "warning" | "critical";
  }> = [];
  for (const cred of credentials) {
    if (cred.rotationState === "expired") {
      out.push({
        code: "credential_expired",
        message: `Credential "${cred.label}" has expired.`,
        severity: "critical",
      });
    } else if (cred.rotationState === "expiring") {
      out.push({
        code: "credential_expiring",
        message: `Credential "${cred.label}" expires soon${
          cred.expiresAt ? ` (${cred.expiresAt})` : ""
        }.`,
        severity: "warning",
      });
    }
  }
  return out;
}
