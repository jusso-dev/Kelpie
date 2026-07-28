import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, type Attachment } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { authorizeCase, resolveTokenActor } from "@/lib/access";
import {
  EvidenceError,
  listEvidenceForCase,
  uploadEvidenceCore,
} from "@/lib/evidence/core";

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
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "view_metadata",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
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
  const actor = await resolveTokenActor(auth.token);
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "edit",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  const [userActor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  if (!userActor) {
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
      actorId: userActor.id,
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
