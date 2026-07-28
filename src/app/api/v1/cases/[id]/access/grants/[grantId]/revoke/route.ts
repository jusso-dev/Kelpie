import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  AccessError,
  resolveTokenActor,
  revokeAccessGrant,
} from "@/lib/access";

type Params = { params: Promise<{ id: string; grantId: string }> };

const bodySchema = z.object({
  reason: z.string().min(8).max(2000),
});

export async function POST(req: Request, context: Params) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id, grantId } = await context.params;
  const actor = await resolveTokenActor(auth.token);
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await revokeAccessGrant(
      auth.token.organisationId,
      actor,
      id,
      grantId,
      parsed.data.reason,
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
