import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EvidenceCollectionError,
  addEvidenceToCollectionCore,
  removeEvidenceFromCollectionCore,
} from "@/lib/evidence/collections";

const addSchema = z.object({ collectionId: z.string().min(1) });

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "evidence:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
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
  if (!actor) {
    return NextResponse.json(
      { error: "This action requires a token created by a user" },
      { status: 400 },
    );
  }
  try {
    const evidence = await addEvidenceToCollectionCore({
      collectionId: parsed.data.collectionId,
      evidenceId: id,
      organisationId: auth.token.organisationId,
      actorId: actor.id,
    });
    const { storageKey: _storageKey, ...safe } = evidence;
    return NextResponse.json({ evidence: safe });
  } catch (err) {
    if (err instanceof EvidenceCollectionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "evidence:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
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
  try {
    const evidence = await removeEvidenceFromCollectionCore({
      evidenceId: id,
      organisationId: auth.token.organisationId,
      actorId: actor.id,
    });
    const { storageKey: _storageKey, ...safe } = evidence;
    return NextResponse.json({ evidence: safe });
  } catch (err) {
    if (err instanceof EvidenceCollectionError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
