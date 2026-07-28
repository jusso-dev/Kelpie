import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EVIDENCE_RELATIONSHIP_TYPES,
  EvidenceItemError,
  getEvidenceItemInOrg,
  linkEvidenceRelationshipCore,
  listEvidenceRelationshipsFor,
} from "@/lib/investigations/evidence-items-core";

const createSchema = z.object({
  targetEvidenceId: z.string().min(1),
  relationshipType: z.enum(EVIDENCE_RELATIONSHIP_TYPES),
  reason: z.string().min(1),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const evidenceItem = await getEvidenceItemInOrg(id, auth.token.organisationId);
  if (!evidenceItem) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const relationships = await listEvidenceRelationshipsFor(id, auth.token.organisationId);
  return NextResponse.json({ relationships });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
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
    const relationship = await linkEvidenceRelationshipCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      sourceEvidenceId: id,
      targetEvidenceId: parsed.data.targetEvidenceId,
      relationshipType: parsed.data.relationshipType,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ relationship }, { status: 201 });
  } catch (err) {
    if (err instanceof EvidenceItemError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
