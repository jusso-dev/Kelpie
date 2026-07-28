import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  acceptSuggestionCore,
  getSuggestionInOrg,
  rejectSuggestionCore,
} from "@/lib/correlation/evaluate-core";
import { correlationErrorResponse } from "@/lib/correlation/http";

const actionSchema = z.object({
  action: z.enum(["accept", "reject"]),
  reason: z.string().min(1),
  expectedVersions: z.record(z.string(), z.number()).optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const suggestion = await getSuggestionInOrg(id, auth.token.organisationId);
  if (!suggestion) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ suggestion });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "correlation:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  try {
    if (parsed.data.action === "reject") {
      const suggestion = await rejectSuggestionCore({
        organisationId: auth.token.organisationId,
        actorId: actor?.id ?? null,
        suggestionId: id,
        reason: parsed.data.reason,
      });
      return NextResponse.json({ suggestion });
    }
    const accepted = await acceptSuggestionCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      suggestionId: id,
      reason: parsed.data.reason,
      expectedVersions: parsed.data.expectedVersions,
    });
    return NextResponse.json(accepted);
  } catch (err) {
    const res = correlationErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
