import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_CLASSIFICATIONS,
  CASE_SEVERITIES,
  getOrgReviewPolicy,
  setOrgReviewPolicy,
} from "@/lib/post-incident-review";

export const dynamic = "force-dynamic";

const policySchema = z.object({
  enabled: z.boolean(),
  requireBySeverities: z.array(z.enum(CASE_SEVERITIES)),
  requireByClassifications: z.array(z.enum(CASE_CLASSIFICATIONS)),
  requireForAllCases: z.boolean(),
  dueDaysAfterClose: z.number().int().min(1).max(365),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const policy = await getOrgReviewPolicy(auth.token.organisationId);
  return NextResponse.json(
    { policy },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PUT(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "reviews:admin");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = policySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join("; ") },
      { status: 400 },
    );
  }
  const policy = await setOrgReviewPolicy(
    auth.token.organisationId,
    parsed.data,
  );
  return NextResponse.json(
    { policy },
    { headers: { "cache-control": "private, no-store" } },
  );
}
