import { NextResponse } from "next/server";
import {
  markUpdateRead,
  requireStakeholderAuth,
  StakeholderError,
} from "@/lib/stakeholder";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ updateId: string }> },
) {
  try {
    const ctx = await requireStakeholderAuth(req);
    const { updateId } = await params;
    await markUpdateRead(ctx, updateId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof StakeholderError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
