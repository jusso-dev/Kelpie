import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CaseOwnershipError,
  createHandoffCore,
  listHandoffsCore,
} from "@/lib/case-ownership-core";
import { CaseVersionConflictError } from "@/lib/cases-core";

const createSchema = z.object({
  toUserId: z.string().min(1).nullable().optional(),
  toQueueId: z.string().min(1).nullable().optional(),
  note: z.string().min(1),
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
  const auth = await authenticateApiTokenWithScope(req, "watchers:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const handoffs = await listHandoffsCore(auth.token.organisationId, id);
  return NextResponse.json({ handoffs });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "watchers:write");
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
    const handoff = await createHandoffCore(
      auth.token.organisationId,
      actor?.id ?? null,
      id,
      parsed.data,
    );
    return NextResponse.json({ handoff }, { status: 201 });
  } catch (err) {
    if (err instanceof CaseVersionConflictError) {
      return NextResponse.json(
        { error: "version_conflict", current: err.current },
        { status: 409 },
      );
    }
    if (err instanceof CaseOwnershipError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
