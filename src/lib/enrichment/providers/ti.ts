import { db } from "@/db";
import { tiFeeds } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { EnrichmentProvider } from "../types";
import { lookupIndicators } from "@/lib/ti/core";

/**
 * Surfaces threat-intelligence matches for an observable as an enrichment
 * result. Backed by the indexed TI store, so the lookup is sub-second.
 */
export const tiProvider: EnrichmentProvider = {
  name: "ti",
  cacheTtlSeconds: 0,
  supports() {
    return true;
  },
  async isConfigured(organisationId: string) {
    const [row] = await db
      .select({ id: tiFeeds.id })
      .from(tiFeeds)
      .where(
        and(eq(tiFeeds.organisationId, organisationId), eq(tiFeeds.isActive, true)),
      )
      .limit(1);
    return Boolean(row);
  },
  async enrich({ value, organisationId }) {
    const matches = await lookupIndicators(organisationId, value);
    return {
      known_bad: matches.length > 0,
      match_count: matches.length,
      matches,
    };
  },
};
