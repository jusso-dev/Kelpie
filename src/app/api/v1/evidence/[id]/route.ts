import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users, type Attachment } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EvidenceError,
  deleteEvidenceCore,
  getEvidenceInOrg,
  renameEvidenceCore,
  setAcquisitionCore,
  setExaminerNotesCore,
  setLabelsCore,
  setRelevanceCore,
} from "@/lib/evidence/core";

const patchSchema = z.object({
  filename: z.string().min(1).optional(),
  labels: z.array(z.string()).optional(),
  relevance: z.enum(["unknown", "relevant", "not_relevant"]).optional(),
  examinerNotes: z.string().nullable().optional(),
  acquisitionSource: z.string().nullable().optional(),
  acquiredAt: z.string().datetime().nullable().optional(),
});

const deleteSchema = z.object({ reason: z.string().min(1) });

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
  const evidence = await getEvidenceInOrg(id, auth.token.organisationId);
  if (!evidence) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ evidence: toSafeEvidence(evidence) });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "evidence:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  let current = await getEvidenceInOrg(id, auth.token.organisationId);
  if (!current) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
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
    if (parsed.data.filename !== undefined) {
      current = await renameEvidenceCore({
        evidenceId: id,
        organisationId: auth.token.organisationId,
        actorId: actor.id,
        newFilename: parsed.data.filename,
      });
    }
    if (parsed.data.labels !== undefined) {
      current = await setLabelsCore({
        evidenceId: id,
        organisationId: auth.token.organisationId,
        actorId: actor.id,
        labels: parsed.data.labels,
      });
    }
    if (parsed.data.relevance !== undefined) {
      current = await setRelevanceCore({
        evidenceId: id,
        organisationId: auth.token.organisationId,
        actorId: actor.id,
        relevance: parsed.data.relevance,
      });
    }
    if (parsed.data.examinerNotes !== undefined) {
      current = await setExaminerNotesCore({
        evidenceId: id,
        organisationId: auth.token.organisationId,
        actorId: actor.id,
        notes: parsed.data.examinerNotes,
      });
    }
    if (
      parsed.data.acquisitionSource !== undefined ||
      parsed.data.acquiredAt !== undefined
    ) {
      current = await setAcquisitionCore({
        evidenceId: id,
        organisationId: auth.token.organisationId,
        actorId: actor.id,
        acquisitionSource:
          parsed.data.acquisitionSource !== undefined
            ? parsed.data.acquisitionSource
            : current.acquisitionSource,
        acquiredAt:
          parsed.data.acquiredAt !== undefined
            ? parsed.data.acquiredAt
              ? new Date(parsed.data.acquiredAt)
              : null
            : current.acquiredAt,
      });
    }
    return NextResponse.json({ evidence: toSafeEvidence(current) });
  } catch (err) {
    if (err instanceof EvidenceError) {
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
  if (!(await getEvidenceInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
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
    await deleteEvidenceCore({
      evidenceId: id,
      organisationId: auth.token.organisationId,
      actorId: actor.id,
      reason: parsed.data.reason,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof EvidenceError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
