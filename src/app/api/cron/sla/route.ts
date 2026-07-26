import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cron";
import { runSlaChecks } from "@/lib/sla-runner";

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await runSlaChecks()) });
}

export async function GET(req: Request) {
  return POST(req);
}
