import { NextResponse } from "next/server";
import { isAuthorisedCron } from "@/lib/cron";
import { pollDueFeeds } from "@/lib/ti/core";
import { pruneStalePresence } from "@/lib/presence";

export async function POST(req: Request) {
  if (!isAuthorisedCron(req)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const result = await pollDueFeeds();
  // Piggyback presence pruning on this minute tick.
  await pruneStalePresence().catch(() => {});
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return POST(req);
}
