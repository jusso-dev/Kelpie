import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  AttackMappingError,
  removeMappingCore,
  updateMappingCore,
} from "@/lib/attack/mapping-core";

const updateSchema = z.object({
  confidence: z.number().int().min(0).max(100).nullable().optional(),
  source: z.string().trim().max(64).optional(),
  notes: z.string().max(10_000).nullable().optional(),
  detectionNotes: z.string().max(10_000).nullable().optional(),
  responseNotes: z.string().max(10_000).nullable().optional(),
  actorAttribution: z.string().max(500).nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "attack:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const mapping = await updateMappingCore(auth.token.organisationId, null, id, parsed.data);
    return NextResponse.json({ mapping });
  } catch (error) {
    if (error instanceof AttackMappingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The technique mapping could not be updated" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "attack:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await params;
  try {
    await removeMappingCore(auth.token.organisationId, null, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AttackMappingError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The technique mapping could not be removed" }, { status: 500 });
  }
}
