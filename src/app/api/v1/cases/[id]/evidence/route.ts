import { NextResponse } from "next/server";
import { db } from "@/db";
import { cases, users, type Attachment } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EvidenceError,
  listEvidenceForCase,
  uploadEvidenceCore,
} from "@/lib/evidence/core";

async function caseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

function toSafeEvidence(row: Attachment) {
  const { storageKey: _storageKey, ...safe } = row;
  return safe;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "evidence:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await listEvidenceForCase(id, auth.token.organisationId);
  return NextResponse.json({ evidence: rows.map(toSafeEvidence) });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "evidence:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  if (!actor) {
    return NextResponse.json(
      { error: "This action requires a token created by a user" },
      { status: 400 },
    );
  }
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!formData || !(file instanceof File)) {
    return NextResponse.json({ error: "A file is required" }, { status: 400 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const evidence = await uploadEvidenceCore({
      organisationId: auth.token.organisationId,
      caseId: id,
      actorId: actor.id,
      buffer,
      filename: file.name,
      declaredContentType: file.type || null,
    });
    return NextResponse.json(
      { evidence: toSafeEvidence(evidence) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof EvidenceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
