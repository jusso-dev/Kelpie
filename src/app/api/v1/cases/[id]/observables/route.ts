import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { observables } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { authorizeCase, resolveTokenActor } from "@/lib/access";
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

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "observables:read");
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
