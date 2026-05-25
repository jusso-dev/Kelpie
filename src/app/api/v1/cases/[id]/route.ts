import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import {
  caseTasks,
  cases,
  observables,
  timelineEvents,
} from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  CASE_ENUMS,
  patchCaseCore,
  setCaseStatusCore,
} from "@/lib/cases-core";
import { fireWebhook } from "@/lib/webhooks";

const patchSchema = z.object({
  status: z.enum(CASE_ENUMS.status).optional(),
  severity: z.enum(CASE_ENUMS.severity).optional(),
  classification: z.enum(CASE_ENUMS.classification).optional(),
  tlp: z.enum(CASE_ENUMS.tlp).optional(),
  pap: z.enum(CASE_ENUMS.pap).optional(),
  assigneeId: z.string().nullable().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  tags: z.array(z.string()).optional(),
  dataClassificationTags: z.array(z.string()).optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const [c] = await db
    .select()
    .from(cases)
    .where(
      and(eq(cases.id, id), eq(cases.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [obs, tasks, timeline] = await Promise.all([
    db.select().from(observables).where(eq(observables.caseId, id)),
    db.select().from(caseTasks).where(eq(caseTasks.caseId, id)),
    db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.caseId, id))
      .orderBy(desc(timelineEvents.occurredAt))
      .limit(50),
  ]);

  return NextResponse.json({
    ...c,
    observables: obs,
    tasks,
    recent_timeline: timeline,
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
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

  if (parsed.data.status) {
    await setCaseStatusCore(
      auth.token.organisationId,
      null,
      id,
      parsed.data.status,
    );
    await fireWebhook(auth.token.organisationId, "case.status_changed", {
      case_id: id,
      to: parsed.data.status,
    });
    if (parsed.data.status === "closed") {
      await fireWebhook(auth.token.organisationId, "case.closed", { case_id: id });
    }
  }
  const { status, ...patch } = parsed.data;
  if (Object.keys(patch).length > 0) {
    await patchCaseCore(auth.token.organisationId, null, id, patch);
  }
  const [updated] = await db
    .select()
    .from(cases)
    .where(
      and(eq(cases.id, id), eq(cases.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  return NextResponse.json(updated);
}
