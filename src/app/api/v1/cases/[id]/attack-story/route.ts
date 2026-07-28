import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  AttackStoryError,
  addStoryEntryCore,
  listStoryCore,
} from "@/lib/attack/story-core";

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000).nullable().optional(),
  provenance: z.enum(["analyst", "provider"]).optional(),
  sourceRef: z.string().trim().max(256).nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  techniqueId: z.string().trim().max(32).nullable().optional(),
  mappingId: z.string().trim().max(128).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "attack:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  try {
    const entries = await listStoryCore(auth.token.organisationId, id);
    return NextResponse.json({ entries });
  } catch (error) {
    if (error instanceof AttackStoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

export async function POST(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "attack:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const entry = await addStoryEntryCore(auth.token.organisationId, null, id, parsed.data);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (error) {
    if (error instanceof AttackStoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The story entry could not be created" }, { status: 500 });
  }
}
