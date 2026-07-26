import { NextResponse } from "next/server";
import { pollDueCaseSources } from "@/lib/case-sources/core";
import { isAuthorisedCron } from "@/lib/cron";

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await pollDueCaseSources()) });
}

export async function GET(req: Request) {
  return POST(req);
}
