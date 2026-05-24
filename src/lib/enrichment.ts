import dns from "node:dns/promises";
import { db } from "@/db";
import { observables } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Phase 1 enrichment is intentionally narrow: reverse DNS for IPs and basic
 * parsing for URLs. The provider interface is sketched out so phase 2 can
 * add reputation lookups behind it without touching call sites.
 */

export interface EnrichmentProvider {
  name: string;
  supports(type: string): boolean;
  enrich(value: string): Promise<Record<string, unknown>>;
}

class ReverseDnsProvider implements EnrichmentProvider {
  name = "reverse_dns";
  supports(type: string) {
    return type === "ip";
  }
  async enrich(value: string) {
    try {
      const hostnames = await dns.reverse(value);
      return { reverse_dns: hostnames };
    } catch (err) {
      return { reverse_dns_error: (err as Error).message };
    }
  }
}

class UrlParseProvider implements EnrichmentProvider {
  name = "url_parse";
  supports(type: string) {
    return type === "url";
  }
  async enrich(value: string) {
    try {
      const url = new URL(value);
      return {
        url_parts: {
          protocol: url.protocol,
          hostname: url.hostname,
          pathname: url.pathname,
          search: url.search,
        },
      };
    } catch {
      return { url_parse_error: "Invalid URL" };
    }
  }
}

const providers: EnrichmentProvider[] = [
  new ReverseDnsProvider(),
  new UrlParseProvider(),
];

export async function enrichObservable(
  observableId: string,
  type: string,
  value: string,
): Promise<void> {
  const enrichment: Record<string, unknown> = { enriched_at: new Date().toISOString() };
  for (const provider of providers) {
    if (!provider.supports(type)) continue;
    try {
      const result = await provider.enrich(value);
      enrichment[provider.name] = result;
    } catch (err) {
      enrichment[`${provider.name}_error`] = (err as Error).message;
    }
  }
  await db
    .update(observables)
    .set({ enrichment })
    .where(eq(observables.id, observableId));
}
