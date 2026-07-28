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
  authorizeCase,
  redactCustomFields,
  resolveTokenActor,
} from "@/lib/access";
import {
  CASE_ENUMS,
  CaseVersionConflictError,
  patchCaseCore,
  setCaseStatusCore,
} from "@/lib/cases-core";
import {
  customFieldsRecord,
  getCustomFieldsForEntity,
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
  const actor = await resolveTokenActor(auth.token);
  // view_metadata required for full detail; missing/forbidden → identical 404.
  const gate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "view_metadata",
  );
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const [c] = await db
    .select()
    .from(cases)
    .where(
      and(eq(cases.id, id), eq(cases.organisationId, auth.token.organisationId)),
    )
    .limit(1);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [obs, tasks, timeline, customFieldRows] = await Promise.all([
    db.select().from(observables).where(eq(observables.caseId, id)),
    db.select().from(caseTasks).where(eq(caseTasks.caseId, id)),
    db
      .select()
      .from(timelineEvents)
      .where(eq(timelineEvents.caseId, id))
      .orderBy(desc(timelineEvents.occurredAt))
      .limit(50),
    getCustomFieldsForEntity(auth.token.organisationId, id),
  ]);

  const redactedFields = redactCustomFields(customFieldRows, gate.permissions, {
    actor,
    grants: gate.ctx.grants,
  });
  const customFields: Record<string, unknown> = {};
  for (const f of redactedFields) customFields[f.key] = f.value;

  return NextResponse.json({
    ...c,
    observables: obs,
    tasks,
    recent_timeline: timeline,
    custom_fields: customFields,
    custom_fields_detail: redactedFields,
    access: {
      permissions: [...gate.permissions],
      accessPolicyVersion: gate.ctx.accessPolicyVersion,
      visibilityMode: gate.ctx.visibilityMode,
    },
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
  const actor = await resolveTokenActor(auth.token);
  const editGate = await authorizeCase(
    auth.token.organisationId,
    id,
    actor,
    "edit",
  );
  if (!editGate.ok) {
    return NextResponse.json(
      { error: editGate.error },
      { status: editGate.status },
    );
  }
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
      if (parsed.data.status === "closed") {
        return NextResponse.json(
          {
            error:
              "Use POST /api/v1/cases/:id/close for closure (policy evaluation and disposition required)",
          },
          { status: 400 },
        );
      }
      const updated = await setCaseStatusCore(
        auth.token.organisationId,
        null,
        id,
        parsed.data.status,
        workingVersion,
      );
      workingVersion = updated.version;
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
