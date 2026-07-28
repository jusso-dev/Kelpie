import { NextResponse } from "next/server";
import { z } from "zod";
import {
  postStakeholderResponse,
  requireStakeholderAuth,
  StakeholderError,
} from "@/lib/stakeholder";

const bodySchema = z.object({
  body: z.string().min(1).max(10_000),
  inReplyToUpdateId: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  try {
    const ctx = await requireStakeholderAuth(req);
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }
    const row = await postStakeholderResponse(
      ctx,
      parsed.data.body,
      parsed.data.inReplyToUpdateId,
    );
    return NextResponse.json({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      attribution: `External · ${ctx.collaborator.displayName}`,
      source: "external",
    });
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
