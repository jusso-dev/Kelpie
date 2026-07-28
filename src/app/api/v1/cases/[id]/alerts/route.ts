import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { newId } from "@/lib/utils";
import {
  AlertError,
  createOrUpdateAlertFromProviderCore,
  getAlertInOrg,
  getOrCreateAlertSourceCore,
  linkAlertToCaseCore,
  listAlertsForCaseCore,
} from "@/lib/investigations/alerts-core";

async function caseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return c ?? null;
}

const createSchema = z.union([
  z.object({ alertId: z.string().min(1), isPrimary: z.boolean().optional() }),
  z.object({
    title: z.string().min(1),
    description: z.string().nullable().optional(),
    severity: z
      .enum(["informational", "low", "medium", "high", "critical"])
      .optional(),
    classification: z.string().nullable().optional(),
    isPrimary: z.boolean().optional(),
  }),
]);

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
    const { items, nextCursor } = await listAlertsForCaseCore(
      auth.token.organisationId,
      id,
      {
        limit: Number.isFinite(limitParam) ? limitParam : null,
        cursor: searchParams.get("cursor"),
      },
    );
    return NextResponse.json({ alerts: items, nextCursor });
  } catch (err) {
    if (err instanceof AlertError) {
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
    if ("alertId" in parsed.data) {
      const existing = await getAlertInOrg(parsed.data.alertId, auth.token.organisationId);
      if (!existing) {
        return NextResponse.json({ error: "Alert not found" }, { status: 404 });
      }
      const link = await linkAlertToCaseCore({
        organisationId: auth.token.organisationId,
        actorId: actor?.id ?? null,
        caseId: id,
        alertId: existing.id,
        isPrimary: parsed.data.isPrimary,
      });
      return NextResponse.json({ alert: existing, link }, { status: 201 });
    }

    const source = await getOrCreateAlertSourceCore({
      organisationId: auth.token.organisationId,
      kind: "manual",
      name: "Manually created alerts",
      createdBy: actor?.id ?? null,
    });
    const { alert } = await createOrUpdateAlertFromProviderCore({
      organisationId: auth.token.organisationId,
      sourceId: source.id,
      externalId: newId("manualalert"),
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      detectionSource: "manual",
      classification: parsed.data.classification ?? null,
      severity: parsed.data.severity,
      providerCreatedAt: new Date(),
    });
    const link = await linkAlertToCaseCore({
      organisationId: auth.token.organisationId,
      actorId: actor?.id ?? null,
      caseId: id,
      alertId: alert.id,
      isPrimary: parsed.data.isPrimary,
    });
    return NextResponse.json({ alert, link }, { status: 201 });
  } catch (err) {
    if (err instanceof AlertError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
