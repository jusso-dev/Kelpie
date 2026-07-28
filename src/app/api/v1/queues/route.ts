import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { createQueueCore, listQueuesCore, queueHealthCore } from "@/lib/queues-core";

const createSchema = z.object({
  teamId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "queues:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const includeHealth = url.searchParams.get("health") === "true";
  const queues = await listQueuesCore(auth.token.organisationId);
  if (!includeHealth) return NextResponse.json({ queues });
  const health = await queueHealthCore(auth.token.organisationId);
  const healthByQueue = new Map(health.map((h) => [h.queueId, h]));
  return NextResponse.json({
    queues: queues.map((q) => ({ ...q, health: healthByQueue.get(q.id) ?? null })),
  });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "queues:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const result = await createQueueCore(
      auth.token.organisationId,
      auth.token.createdBy ?? null,
      parsed.data.teamId,
      parsed.data.name,
      parsed.data.description,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create queue" },
      { status: 400 },
    );
  }
}
