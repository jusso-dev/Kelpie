import { eq } from "drizzle-orm";
import { db } from "@/db";
import { caseSources } from "@/db/schema";
import { createCaseCore } from "@/lib/cases-core";
import { fetchSentinelCases, type SentinelConfig } from "./sentinel";
import {
  fetchDefenderXdrCases,
  type DefenderXdrConfig,
} from "./defender-xdr";

export async function pollCaseSource(
  sourceId: string,
): Promise<{ imported: number; error: string | null }> {
  const [source] = await db
    .select()
    .from(caseSources)
    .where(eq(caseSources.id, sourceId))
    .limit(1);
  if (!source) return { imported: 0, error: "Case source not found" };
  if (
    source.kind !== "microsoft_sentinel" &&
    source.kind !== "microsoft_defender_xdr"
  ) {
    return { imported: 0, error: "Unknown case source kind" };
  }

  try {
    const sourceSystem = `${source.kind}:${source.id}`;
    const result =
      source.kind === "microsoft_sentinel"
        ? await fetchSentinelCases(
            source.config as SentinelConfig,
            sourceSystem,
            source.cursor,
          )
        : await fetchDefenderXdrCases(
            source.config as DefenderXdrConfig,
            sourceSystem,
            source.cursor,
          );
    let imported = 0;
    for (const item of result.cases) {
      const created = await createCaseCore(source.organisationId, null, item.input);
      if (created.created) imported++;
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
    return { imported, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Case import failed";
    await db
      .update(caseSources)
      .set({ lastPolledAt: new Date(), lastError: message })
      .where(eq(caseSources.id, source.id));
    return { imported: 0, error: message };
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
