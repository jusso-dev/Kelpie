import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { createHandoffCore, listHandoffsCore } from "@/lib/handoffs-core";

const createSchema = z.object({
  toUserId: z.string().trim().min(1).nullable().optional(),
  toQueueId: z.string().trim().min(1).nullable().optional(),
  summary: z.string().trim().min(1).max(20_000),
  keyActions: z.array(z.string()).optional(),
  openItems: z.array(z.string()).optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const handoffs = await listHandoffsCore(auth.token.organisationId, id);
  return NextResponse.json({ handoffs });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  if (!auth.token.createdBy) {
    return NextResponse.json(
      { error: "Hand-offs require a token issued with a known creator" },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await createHandoffCore(
      auth.token.organisationId,
      auth.token.createdBy,
      id,
      parsed.data,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not record hand-off" },
      { status: 400 },
    );
  }
}
