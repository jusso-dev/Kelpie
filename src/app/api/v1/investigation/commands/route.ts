import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { listPublicCommands } from "@/lib/investigation-console/core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/v1/investigation/commands — list trusted registered commands. */
export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "investigation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  return NextResponse.json(
    { commands: listPublicCommands() },
    { headers: { "cache-control": "private, no-store" } },
  );
}
