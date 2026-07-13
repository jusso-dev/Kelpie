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
  CaseVersionConflictError,
  patchCaseCore,
  setCaseStatusCore,
} from "@/lib/cases-core";
import { fireWebhook } from "@/lib/webhooks";
import {
  customFieldsRecord,
  setCustomFieldsByKey,
} from "@/lib/custom-fields";

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
  version: z.number().int().optional(),
  custom_fields: z.record(z.string(), z.unknown()).optional(),
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

  const [obs, tasks, timeline, customFields] = await Promise.all([
    db.select().from(observables).where(eq(observables.caseId, id)),
    db.select().from(caseTasks).where(eq(caseTasks.caseId, id)),
    db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.caseId, id))
      .orderBy(desc(timelineEvents.occurredAt))
      .limit(50),
    customFieldsRecord(auth.token.organisationId, id),
  ]);

  return NextResponse.json({
    ...c,
    observables: obs,
    tasks,
    recent_timeline: timeline,
    custom_fields: customFields,
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

  let workingVersion = parsed.data.version;
  try {
    if (parsed.data.status) {
      const updated = await setCaseStatusCore(
        auth.token.organisationId,
        null,
        id,
        parsed.data.status,
        workingVersion,
      );
      workingVersion = updated.version;
      await fireWebhook(auth.token.organisationId, "case.status_changed", {
        case_id: id,
        to: parsed.data.status,
      });
      if (parsed.data.status === "closed") {
        await fireWebhook(auth.token.organisationId, "case.closed", { case_id: id });
      }
    }

    const { status, version, custom_fields, ...patch } = parsed.data;
    if (Object.keys(patch).length > 0) {
      await patchCaseCore(
        auth.token.organisationId,
        null,
        id,
        patch,
        workingVersion,
      );
    }
  } catch (e) {
    if (e instanceof CaseVersionConflictError) {
      return NextResponse.json(
        { error: "version_conflict", current: e.current },
        { status: 409 },
      );
    }
    throw e;
  }
  const { custom_fields } = parsed.data;
  if (custom_fields && Object.keys(custom_fields).length > 0) {
    try {
      await setCustomFieldsByKey(
        auth.token.organisationId,
        null,
        id,
        custom_fields,
        { writeTimeline: true },
      );
    } catch (e) {
      return NextResponse.json(
        { error: "invalid_custom_field", detail: (e as Error).message },
        { status: 400 },
      );
    }
  }
  const [updated] = await db
    .select()
    .from(cases)
    .where(
      and(eq(cases.id, id), eq(cases.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  const customFields = await customFieldsRecord(auth.token.organisationId, id);
  return NextResponse.json({ ...updated, custom_fields: customFields });
}
