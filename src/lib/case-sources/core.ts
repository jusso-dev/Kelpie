import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { caseSources, cases, integrationConnectionStates } from "@/db/schema";
import { createCaseCore } from "@/lib/cases-core";
import { applyInboundCaseUpdate } from "@/lib/integrations/apply-inbound";
import { upsertCredentialReference } from "@/lib/integrations/credentials";
import { classifyHealthError } from "@/lib/integrations/error-category";
import {
  touchConnectionFailure,
  touchConnectionSuccess,
} from "@/lib/integrations/state";
import { fetchSentinelCases, type SentinelConfig } from "./sentinel";
import {
  fetchDefenderXdrCases,
  type DefenderXdrConfig,
} from "./defender-xdr";

export async function pollCaseSource(
  sourceId: string,
): Promise<{ imported: number; updated: number; error: string | null }> {
  const [source] = await db
    .select()
    .from(caseSources)
    .where(eq(caseSources.id, sourceId))
    .limit(1);
  if (!source) return { imported: 0, updated: 0, error: "Case source not found" };
  if (
    source.kind !== "microsoft_sentinel" &&
    source.kind !== "microsoft_defender_xdr"
  ) {
    return { imported: 0, updated: 0, error: "Unknown case source kind" };
  }

  // Honour the integration health pause flag even if isActive lagged.
  const [health] = await db
    .select({ isPaused: integrationConnectionStates.isPaused })
    .from(integrationConnectionStates)
    .where(
      and(
        eq(integrationConnectionStates.organisationId, source.organisationId),
        eq(integrationConnectionStates.connectionKind, "case_source"),
        eq(integrationConnectionStates.connectionId, source.id),
      ),
    )
    .limit(1);
  if (health?.isPaused || !source.isActive) {
    return { imported: 0, updated: 0, error: "Case source is paused" };
  }

  try {
    const sourceSystem = `${source.kind}:${source.id}`;
    const config = source.config as SentinelConfig | DefenderXdrConfig;
    // Keep a credential *reference* (fingerprint only) for expiry/rotation UI.
    if (typeof config.client_secret === "string" && config.client_secret) {
      await upsertCredentialReference({
        organisationId: source.organisationId,
        connectionKind: "case_source",
        connectionId: source.id,
        label: "client_secret",
        reference: `case_sources.config.client_secret`,
        secretForFingerprint: config.client_secret,
        consentedScopes:
          source.kind === "microsoft_sentinel"
            ? ["https://management.azure.com/.default"]
            : ["https://graph.microsoft.com/.default"],
      }).catch(() => {
        // Credential metadata is best-effort; do not fail the poll.
      });
    }

    const result =
      source.kind === "microsoft_sentinel"
        ? await fetchSentinelCases(
            config as SentinelConfig,
            sourceSystem,
            source.cursor,
          )
        : await fetchDefenderXdrCases(
            config as DefenderXdrConfig,
            sourceSystem,
            source.cursor,
          );
    let imported = 0;
    let updated = 0;
    for (const item of result.cases) {
      const created = await createCaseCore(source.organisationId, null, item.input);
      if (created.created) {
        imported++;
        continue;
      }
      // Existing source-linked case: apply field ownership policy.
      const [existing] = await db
        .select()
        .from(cases)
        .where(
          and(
            eq(cases.id, created.id),
            eq(cases.organisationId, source.organisationId),
          ),
        )
        .limit(1);
      if (!existing) continue;
      const apply = await applyInboundCaseUpdate({
        organisationId: source.organisationId,
        connectionKind: "case_source",
        connectionId: source.id,
        caseRow: existing,
        source: {
          title: item.input.title,
          summary: item.input.summary ?? null,
          status: item.input.status,
          severity: item.input.severity,
          classification: item.input.classification,
          sourceUrl: item.input.sourceUrl ?? null,
          sourceUpdatedAt: item.modifiedAt ? new Date(item.modifiedAt) : null,
        },
        sourceProvenance: sourceSystem,
      });
      if (apply.applied.length > 0) updated++;
    }
    await db
      .update(caseSources)
      .set({
        cursor: result.cursor,
        lastPolledAt: new Date(),
        lastError: null,
        importedCaseCount: source.importedCaseCount + imported,
      })
      .where(eq(caseSources.id, source.id));
    await touchConnectionSuccess({
      organisationId: source.organisationId,
      connectionKind: "case_source",
      connectionId: source.id,
      displayName: source.name,
      cursor: result.cursor,
      metadata: { imported, updated },
    });
    return { imported, updated, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Case import failed";
    await db
      .update(caseSources)
      .set({ lastPolledAt: new Date(), lastError: message })
      .where(eq(caseSources.id, source.id));
    await touchConnectionFailure({
      organisationId: source.organisationId,
      connectionKind: "case_source",
      connectionId: source.id,
      displayName: source.name,
      errorCategory: classifyHealthError(message) ?? "provider_error",
      errorSummary: message,
    });
    return { imported: 0, updated: 0, error: message };
  }
}

export async function pollDueCaseSources(): Promise<{
  polled: number;
  imported: number;
}> {
  const candidates = await db
    .select()
    .from(caseSources)
    .where(eq(caseSources.isActive, true));
  const now = Date.now();
  let polled = 0;
  let imported = 0;
  for (const source of candidates) {
    const due =
      !source.lastPolledAt ||
      now - source.lastPolledAt.getTime() >=
        source.pollIntervalMinutes * 60_000;
    if (!due) continue;
    const result = await pollCaseSource(source.id);
    polled++;
    imported += result.imported;
  }
  return { polled, imported };
}
