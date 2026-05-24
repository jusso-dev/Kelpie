import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases, observables } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  addObservableCore,
  OBSERVABLE_TLPS,
  OBSERVABLE_TYPES,
} from "@/lib/observables-core";
import { enrichObservable } from "@/lib/enrichment";

const createSchema = z.object({
  type: z.enum(OBSERVABLE_TYPES),
  value: z.string().min(1),
  tlp: z.enum(OBSERVABLE_TLPS).optional(),
  description: z.string().nullable().optional(),
  isIoc: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
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
  const auth = await authenticateApiTokenWithScope(req, "observables:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rows = await db
    .select()
    .from(observables)
    .where(eq(observables.caseId, id))
    .orderBy(desc(observables.createdAt));
  return NextResponse.json({ observables: rows });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "observables:write");
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
  const created = await addObservableCore(auth.token.organisationId, null, id, parsed.data);
  void enrichObservable(created.id, parsed.data.type, parsed.data.value).catch(() => {});
  return NextResponse.json({ id: created.id }, { status: 201 });
}
