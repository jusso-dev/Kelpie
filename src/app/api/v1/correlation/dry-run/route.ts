import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { dryRunCorrelationCore } from "@/lib/correlation/evaluate-core";
import { correlationErrorResponse } from "@/lib/correlation/http";

const schema = z.object({
  ruleId: z.string().optional(),
  alertIds: z.array(z.string()).optional(),
});

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const results = await dryRunCorrelationCore({
      organisationId: auth.token.organisationId,
      ...parsed.data,
    });
    return NextResponse.json({ results });
  } catch (err) {
    const res = correlationErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
