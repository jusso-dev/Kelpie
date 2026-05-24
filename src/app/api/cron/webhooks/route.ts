import { NextResponse } from "next/server";
import { processPendingDeliveries } from "@/lib/webhooks";
import { isAuthorisedCron } from "@/lib/cron";

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await processPendingDeliveries();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return POST(req);
}
