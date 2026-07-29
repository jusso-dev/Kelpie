import type { EnrichmentProvider } from "../types";
import { getBrolgaConfiguration } from "@/lib/brolga/config";
import { lookupBrolgaForObservable } from "@/lib/brolga/lookup";
import { packDispositionSummary } from "@/lib/brolga/client";

/**
 * Optional enrichment via Brolga context packs.
 * Inactive until an admin enables Brolga and the engine exposes /v1/context.
 */
export const brolgaProvider: EnrichmentProvider = {
  name: "brolga",
  cacheTtlSeconds: 300,
  supports(type: string) {
    return ["ip", "domain", "url", "file_hash", "email", "hostname"].includes(
      type,
    );
  },
  async isConfigured(organisationId: string) {
    const config = await getBrolgaConfiguration(organisationId);
    return config.enabled && config.configured;
  },
  async enrich({ type, value, organisationId }) {
    const result = await lookupBrolgaForObservable({
      organisationId,
      type,
      value,
    });

    if (result.status === "ok") {
      return {
        status: "ok",
        summary: packDispositionSummary(result.pack),
        disposition: result.pack.disposition ?? null,
        confidence:
          typeof result.pack.confidence === "number"
            ? result.pack.confidence
            : null,
        claim_count: Array.isArray(result.pack.claims)
          ? result.pack.claims.length
          : 0,
        entity_count: Array.isArray(result.pack.entities)
          ? result.pack.entities.length
          : 0,
        fingerprint: result.pack.fingerprint ?? null,
        pack: result.pack,
        latency_ms: result.latencyMs,
      };
    }

    // Non-ok statuses are still a successful provider response shape so the
    // registry marks ok:true with structured data (not a hard failure).
    return {
      status: result.status,
      message: result.message,
      pack: null,
    };
  },
};
