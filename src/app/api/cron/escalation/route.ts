import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cron";
import { runEscalationChecks } from "@/lib/escalation-runner";

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await runEscalationChecks()) });
}

export async function GET(req: Request) {
  return POST(req);
}
