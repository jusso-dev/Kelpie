import { NextResponse } from "next/server";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { isAuthorisedCron } from "@/lib/cron";
import { enrichOrganisationPending } from "@/lib/enrichment/registry";
import { purgeExpiredCache } from "@/lib/enrichment/cache";

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  await purgeExpiredCache();
  const orgs = await db.select({ id: organisations.id }).from(organisations);
  let enriched = 0;
  for (const o of orgs) {
    const r = await enrichOrganisationPending(o.id, 50);
    enriched += r.enriched;
  }
  return NextResponse.json({ ok: true, enriched, orgs: orgs.length });
}

export async function GET(req: Request) {
  return POST(req);
}
