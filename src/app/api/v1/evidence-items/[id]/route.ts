import { NextResponse } from "next/server";
import { z } from "zod";
import {
  EvidenceItemError,
  getEvidenceItemInOrg,
  setEvidenceItemNotesCore,
  setEvidenceItemRemediationCore,
  setEvidenceItemVerdictCore,
} from "@/lib/investigations/evidence-items-core";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

const patchSchema = z.object({
  verdict: z.enum(["unknown", "clean", "suspicious", "malicious"]).optional(),
  remediationState: z
    .enum(["none", "pending", "remediated", "not_applicable"])
    .optional(),
  analystNotes: z.string().nullable().optional(),
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
  return NextResponse.json({ evidenceItem });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "alerts:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
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
  try {
    let evidenceItem = await getEvidenceItemInOrg(id, auth.token.organisationId);
    if (!evidenceItem) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (parsed.data.verdict !== undefined) {
      evidenceItem = await setEvidenceItemVerdictCore({
        organisationId: auth.token.organisationId,
        actorId: actor?.id ?? null,
        evidenceItemId: id,
        verdict: parsed.data.verdict,
      });
    }
    if (parsed.data.remediationState !== undefined) {
      evidenceItem = await setEvidenceItemRemediationCore({
        organisationId: auth.token.organisationId,
        actorId: actor?.id ?? null,
        evidenceItemId: id,
        remediationState: parsed.data.remediationState,
      });
    }
    if (parsed.data.analystNotes !== undefined) {
      evidenceItem = await setEvidenceItemNotesCore({
        organisationId: auth.token.organisationId,
        evidenceItemId: id,
        notes: parsed.data.analystNotes,
      });
    }
    return NextResponse.json({ evidenceItem });
  } catch (err) {
    if (err instanceof EvidenceItemError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
