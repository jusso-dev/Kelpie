import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cron";
import { pollAllActiveConnectors } from "@/lib/connectors/core";

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await pollAllActiveConnectors();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return POST(req);
}
