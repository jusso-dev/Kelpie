import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  IMPROVEMENT_TICKET_SYNC_STATES,
  ImprovementRegisterError,
  serializeImprovement,
  syncExternalTicketCore,
} from "@/lib/improvement-register";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * Bounded external ticket sync. Only ticket reference fields and sync state
 * may change — ownership, links, status, recurrence, and history are preserved.
 */
const syncSchema = z.object({
  externalTicketRef: z.string().trim().max(200).nullable().optional(),
  externalTicketUrl: z.string().trim().max(2048).nullable().optional(),
  syncState: z.enum(IMPROVEMENT_TICKET_SYNC_STATES).optional(),
  conflict: z.boolean().optional(),
  error: z.string().trim().max(2_000).nullable().optional(),
});

export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "improvements:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = syncSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  try {
    const improvement = await syncExternalTicketCore(
      auth.token.organisationId,
      id,
      auth.token.createdBy,
      parsed.data,
    );
    return NextResponse.json(
      { improvement: serializeImprovement(improvement) },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (err) {
    if (err instanceof ImprovementRegisterError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
