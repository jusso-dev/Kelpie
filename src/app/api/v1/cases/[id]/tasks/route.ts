import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { caseTasks } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { authorizeCase, resolveTokenActor } from "@/lib/access";
import { createTaskCore } from "@/lib/tasks-core";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "tasks:read");
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
    .from(caseTasks)
    .where(eq(caseTasks.caseId, id))
    .orderBy(asc(caseTasks.orderIndex), asc(caseTasks.id));
  return NextResponse.json({ tasks: rows });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "tasks:write");
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
  const created = await createTaskCore(auth.token.organisationId, auth.token.createdBy, id, {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    assigneeId: parsed.data.assigneeId ?? null,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
