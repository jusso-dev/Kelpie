import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { caseTasks, cases } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { createTaskCore } from "@/lib/tasks-core";

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
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
  const auth = await authenticateApiTokenWithScope(req, "tasks:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
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
  const created = await createTaskCore(auth.token.organisationId, auth.token.createdBy, id, {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    assigneeId: parsed.data.assigneeId ?? null,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
  });
  return NextResponse.json({ id: created.id }, { status: 201 });
}
