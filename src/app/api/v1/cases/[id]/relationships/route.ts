import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CaseRelationshipError,
  RELATIONSHIP_TYPES,
  linkCasesCore,
  listRelationshipsCore,
} from "@/lib/case-relationships-core";

const createSchema = z.object({
  targetCaseId: z.string().min(1),
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(100).nullable().optional(),
  origin: z.enum(["analyst", "provider", "rule"]).optional(),
  ruleId: z.string().nullable().optional(),
  ruleVersion: z.string().nullable().optional(),
});

async function caseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_relationships:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const relationships = await listRelationshipsCore(auth.token.organisationId, id);
    return NextResponse.json({ relationships });
  } catch (err) {
    if (err instanceof CaseRelationshipError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "case_relationships:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
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
    const relationship = await linkCasesCore(
      auth.token.organisationId,
      actor?.id ?? null,
      id,
      parsed.data,
    );
    return NextResponse.json({ relationship }, { status: 201 });
  } catch (err) {
    if (err instanceof CaseRelationshipError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
