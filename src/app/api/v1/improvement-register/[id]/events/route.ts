import { NextResponse } from "next/server";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  ImprovementRegisterError,
  listImprovementEventsCore,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  try {
    const events = await listImprovementEventsCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
    );
    return NextResponse.json(
      {
        events: events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          fromStatus: e.fromStatus,
          toStatus: e.toStatus,
          actorId: e.actorId,
          payload: e.payload,
          createdAt: e.createdAt.toISOString(),
        })),
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
