import { db } from "@/db";
import { observables, cases, organisations } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { EnrichmentProvider, EnrichmentResult } from "./types";
import { readCache, writeCache } from "./cache";
import { reverseDnsProvider } from "./providers/reverse-dns";
import { urlParseProvider } from "./providers/url-parse";
import { virusTotalProvider } from "./providers/virustotal";

const allProviders: EnrichmentProvider[] = [
  reverseDnsProvider,
  urlParseProvider,
  virusTotalProvider,
];

export function listProviders() {
  return allProviders.map((p) => ({ name: p.name, supports: ["ip", "domain", "url", "file_hash", "email", "hostname", "username"].filter((t) => p.supports(t)) }));
}

async function orgSettings(organisationId: string): Promise<Record<string, unknown>> {
  const [row] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return (row?.settings as Record<string, unknown>) ?? {};
}

function providerEnabled(
  settings: Record<string, unknown>,
  providerName: string,
): boolean {
  const disabled = settings.enrichment_disabled;
  if (Array.isArray(disabled) && disabled.includes(providerName)) return false;
  return true;
}

async function runProvider(
  provider: EnrichmentProvider,
  type: string,
  value: string,
  organisationId: string,
): Promise<EnrichmentResult> {
  const start = Date.now();
  try {
    if (provider.cacheTtlSeconds > 0) {
      const cached = await readCache(provider.name, type, value);
      if (cached) {
        return {
          ok: true,
          data: cached,
          latencyMs: Date.now() - start,
          cached: true,
        };
      }
    }
    const ok = await Promise.race([
      provider.enrich({ type, value, organisationId }),
      new Promise<Record<string, unknown>>((_, reject) =>
        setTimeout(() => reject(new Error("provider_timeout")), 20000),
      ),
    ]);
    if (provider.cacheTtlSeconds > 0) {
      await writeCache(provider.name, type, value, ok, provider.cacheTtlSeconds);
    }
    return { ok: true, data: ok, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: (err as Error).message,
      latencyMs: Date.now() - start,
    };
  }
}

export async function enrichObservableViaRegistry(
  observableId: string,
): Promise<void> {
  const [row] = await db
    .select({
      obs: observables,
      organisationId: cases.organisationId,
    })
    .from(observables)
    .innerJoin(cases, eq(cases.id, observables.caseId))
    .where(eq(observables.id, observableId))
    .limit(1);
  if (!row) return;
  const settings = await orgSettings(row.organisationId);

  const eligible = allProviders.filter(
    (p) => p.supports(row.obs.type) && providerEnabled(settings, p.name),
  );
  if (eligible.length === 0) return;

  const enrichment: Record<string, unknown> = {
    enriched_at: new Date().toISOString(),
  };
  const previous = (row.obs.enrichment as Record<string, unknown>) ?? {};
  Object.assign(enrichment, previous);

  await Promise.all(
    eligible.map(async (p) => {
      const result = await runProvider(p, row.obs.type, row.obs.value, row.organisationId);
      enrichment[p.name] = {
        ok: result.ok,
        data: result.data,
        error: result.error,
        latency_ms: result.latencyMs,
        cached: result.cached ?? false,
        at: new Date().toISOString(),
      };
    }),
  );

  await db
    .update(observables)
    .set({ enrichment })
    .where(eq(observables.id, observableId));
}

export async function enrichOrganisationPending(
  organisationId: string,
  limit = 25,
): Promise<{ enriched: number }> {
  // Pick observables that have not yet been enriched. The MVP treats empty
  // enrichment ({}) as needing a pass.
  const rows = await db
    .select({ id: observables.id })
    .from(observables)
    .innerJoin(cases, eq(cases.id, observables.caseId))
    .where(
      and(
        eq(cases.organisationId, organisationId),
        sql`${observables.enrichment} = '{}'::jsonb`,
      ),
    )
    .limit(limit);
  for (const r of rows) {
    await enrichObservableViaRegistry(r.id);
  }
  return { enriched: rows.length };
}
