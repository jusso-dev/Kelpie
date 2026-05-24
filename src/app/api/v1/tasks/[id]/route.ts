import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { caseTasks, cases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { patchTaskCore, TASK_STATUS_VALUES } from "@/lib/tasks-core";

const patchSchema = z.object({
  status: z.enum(TASK_STATUS_VALUES).optional(),
  assigneeId: z.string().nullable().optional(),
  dueAt: z.string().datetime().nullable().optional(),
  title: z.string().optional(),
  description: z.string().nullable().optional(),
});

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "tasks:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  // Confirm the task lives in this org before mutating.
  const [row] = await db
    .select({ id: caseTasks.id })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(
      and(eq(caseTasks.id, id), eq(cases.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  await patchTaskCore(auth.token.organisationId, null, id, {
    status: parsed.data.status,
    assigneeId: parsed.data.assigneeId,
    dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : parsed.data.dueAt === null ? null : undefined,
    title: parsed.data.title,
    description: parsed.data.description ?? undefined,
  });
  const [updated] = await db.select().from(caseTasks).where(eq(caseTasks.id, id)).limit(1);
  return NextResponse.json(updated);
}
