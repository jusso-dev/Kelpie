import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  AttackStoryError,
  reorderStoryEntryCore,
  removeStoryEntryCore,
  updateStoryEntryCore,
} from "@/lib/attack/story-core";

const patchSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  description: z.string().max(10_000).nullable().optional(),
  sourceRef: z.string().trim().max(256).nullable().optional(),
  occurredAt: z.string().datetime().nullable().optional(),
  targetIndex: z.number().int().min(0).optional(),
});

type Params = { params: Promise<{ id: string; entryId: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "attack:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, entryId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    if (parsed.data.targetIndex !== undefined) {
      const entries = await reorderStoryEntryCore(
        auth.token.organisationId,
        null,
        id,
        entryId,
        parsed.data.targetIndex,
      );
      return NextResponse.json({ entries });
    }
    const entry = await updateStoryEntryCore(auth.token.organisationId, null, id, entryId, parsed.data);
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof AttackStoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The story entry could not be updated" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: Params) {
  const auth = await authenticateApiTokenWithScope(req, "attack:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, entryId } = await params;
  try {
    await removeStoryEntryCore(auth.token.organisationId, null, id, entryId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AttackStoryError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "The story entry could not be removed" }, { status: 500 });
  }
}
