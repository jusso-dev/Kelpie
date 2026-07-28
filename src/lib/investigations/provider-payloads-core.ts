/**
 * Bounded, access-controlled references to raw provider payloads (issue
 * #55). An alert or evidence item never carries the provider's raw JSON
 * inline, and a timeline event never embeds it either — both only ever
 * store a `rawPayloadRefId` pointing at a row here. Reading the payload back
 * always goes through `getProviderPayloadReferenceCore`, which callers gate
 * behind a dedicated, sensitive scope (see `alerts:raw_payload:read` in
 * `src/lib/scopes.ts`), the same access-control shape evidence downloads use.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { providerPayloadReferences, type ProviderPayloadReference } from "@/db/schema";
import { newId } from "@/lib/utils";
import { redactAuditValue } from "@/lib/audit/redact";

/** Hard bound on stored payload size; oversized payloads are replaced with a marker rather than truncated mid-structure. */
export const MAX_PAYLOAD_REFERENCE_BYTES = 256 * 1024;

export class ProviderPayloadError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ProviderPayloadError";
    this.status = status;
  }
}

export type StoreProviderPayloadInput = {
  organisationId: string;
  sourceId?: string | null;
  externalRef: string;
  payload: Record<string, unknown>;
  createdBy?: string | null;
  expiresAt?: Date | null;
};

/** Redacts, size-bounds, and stores a reference to a raw provider payload. Never stores the payload unbounded or unredacted. */
export async function storeProviderPayloadReferenceCore(
  input: StoreProviderPayloadInput,
): Promise<ProviderPayloadReference> {
  if (!input.externalRef.trim()) {
    throw new ProviderPayloadError("externalRef is required");
  }
  // The bound is judged against the *original* payload size: redaction
  // truncates individual long strings/arrays but must never be relied on to
  // shrink an oversized payload down under the cap on its own — an oversized
  // payload is replaced with a marker outright rather than partially stored.
  const originalSizeBytes = Buffer.byteLength(JSON.stringify(input.payload), "utf8");
  const sizeBytes = Math.max(originalSizeBytes, 0);
  const bounded =
    originalSizeBytes > MAX_PAYLOAD_REFERENCE_BYTES
      ? {
          truncated: true,
          note: `Payload exceeded the ${MAX_PAYLOAD_REFERENCE_BYTES} byte bound and was omitted.`,
        }
      : (redactAuditValue(input.payload) as Record<string, unknown>);

  const [row] = await db
    .insert(providerPayloadReferences)
    .values({
      id: newId("ppref"),
      organisationId: input.organisationId,
      sourceId: input.sourceId ?? null,
      externalRef: input.externalRef.trim(),
      payload: bounded,
      sizeBytes,
      redacted: true,
      expiresAt: input.expiresAt ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new ProviderPayloadError("Payload reference could not be stored", 500);
  return row;
}

export async function getProviderPayloadReferenceCore(
  id: string,
  organisationId: string,
): Promise<ProviderPayloadReference | null> {
  const [row] = await db
    .select()
    .from(providerPayloadReferences)
    .where(
      and(
        eq(providerPayloadReferences.id, id),
        eq(providerPayloadReferences.organisationId, organisationId),
      ),
    )
    .limit(1);
  return row ?? null;
}
