import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  EvidenceItemError,
  createEvidenceItemCore,
  listEvidenceItemsForCase,
} from "@/lib/investigations/evidence-items-core";

async function caseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

const createSchema = z.object({
  type: z.string().min(1),
  alertId: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  attachmentId: z.string().nullable().optional(),
  value: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  source: z.string().optional(),
  confidence: z.number().min(0).max(100).nullable().optional(),
  firstSeenAt: z.string().datetime().nullable().optional(),
  lastSeenAt: z.string().datetime().nullable().optional(),
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
  const { searchParams } = new URL(req.url);
  const limitParam = Number(searchParams.get("limit") ?? "");
  try {
    const { items, nextCursor } = await listEvidenceItemsForCase(
      auth.token.organisationId,
      id,
      {
        limit: Number.isFinite(limitParam) ? limitParam : null,
        cursor: searchParams.get("cursor"),
      },
    );
    return NextResponse.json({ evidenceItems: items, nextCursor });
  } catch (err) {
    if (err instanceof EvidenceItemError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
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
    const evidenceItem = await createEvidenceItemCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      caseId: id,
      alertId: parsed.data.alertId ?? null,
      entityId: parsed.data.entityId ?? null,
      attachmentId: parsed.data.attachmentId ?? null,
      type: parsed.data.type,
      value: parsed.data.value ?? null,
      description: parsed.data.description ?? null,
      source: parsed.data.source,
      confidence: parsed.data.confidence ?? null,
      firstSeenAt: parsed.data.firstSeenAt ? new Date(parsed.data.firstSeenAt) : null,
      lastSeenAt: parsed.data.lastSeenAt ? new Date(parsed.data.lastSeenAt) : null,
    });
    return NextResponse.json({ evidenceItem }, { status: 201 });
  } catch (err) {
    if (err instanceof EvidenceItemError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
