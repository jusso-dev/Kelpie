import { db } from "@/db";
import { caseSequences } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function nextCaseNumber(organisationId: string): Promise<string> {
  const year = new Date().getUTCFullYear();
  // Upsert and bump the per-org, per-year counter atomically.
  const rows = await db
    .insert(caseSequences)
    .values({ organisationId, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: caseSequences.organisationId,
      set: {
        year: sql`CASE WHEN ${caseSequences.year} = ${year} THEN ${caseSequences.year} ELSE ${year} END`,
        lastNumber: sql`CASE WHEN ${caseSequences.year} = ${year} THEN ${caseSequences.lastNumber} + 1 ELSE 1 END`,
      },
    })
    .returning({ year: caseSequences.year, lastNumber: caseSequences.lastNumber });
  const row = rows[0];
  const padded = String(row.lastNumber).padStart(4, "0");
  return `KP-${row.year}-${padded}`;
}
