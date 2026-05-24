import { NextResponse } from "next/server";
import { db } from "@/db";
import { cases, observables } from "@/db/schema";
import { and, eq, ilike } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "observables:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const value = url.searchParams.get("value");
  const exact = url.searchParams.get("exact") === "true";
  if (!value) {
    return NextResponse.json({ error: "value required" }, { status: 400 });
  }
  const filter = exact
    ? eq(observables.value, value)
    : ilike(observables.value, `%${value}%`);
  const rows = await db
    .select({
      id: observables.id,
      type: observables.type,
      value: observables.value,
      tlp: observables.tlp,
      isIoc: observables.isIoc,
      enrichment: observables.enrichment,
      caseId: cases.id,
      caseNumber: cases.caseNumber,
      caseTitle: cases.title,
    })
    .from(observables)
    .innerJoin(cases, eq(cases.id, observables.caseId))
    .where(and(eq(cases.organisationId, auth.token.organisationId), filter))
    .limit(200);
  return NextResponse.json({ observables: rows });
}
