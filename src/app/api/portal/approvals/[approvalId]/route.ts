import { NextResponse } from "next/server";
import { z } from "zod";
import {
  decideStakeholderApproval,
  requireStakeholderAuth,
  StakeholderError,
} from "@/lib/stakeholder";

const bodySchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(2000).optional().nullable(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ approvalId: string }> },
) {
  try {
    const ctx = await requireStakeholderAuth(req);
    const { approvalId } = await params;
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
    const row = await decideStakeholderApproval(
      ctx,
      approvalId,
      parsed.data.decision,
      parsed.data.note,
    );
    return NextResponse.json({
      id: row.id,
      status: row.status,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    });
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
