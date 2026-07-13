import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases } from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { CASE_ENUMS, createCaseCore } from "@/lib/cases-core";
import { fireWebhook } from "@/lib/webhooks";

const createSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  severity: z.enum(CASE_ENUMS.severity).optional(),
  tlp: z.enum(CASE_ENUMS.tlp).optional(),
  pap: z.enum(CASE_ENUMS.pap).optional(),
  classification: z.enum(CASE_ENUMS.classification).optional(),
  assigneeId: z.string().nullable().optional(),
  sourceAlertId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  dataClassificationTags: z.array(z.string()).optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const filters = [eq(cases.organisationId, auth.token.organisationId)];
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const classification = url.searchParams.get("classification");
  const tlp = url.searchParams.get("tlp");
  const assignee = url.searchParams.get("assignee");
  const openedSince = url.searchParams.get("openedSince");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
  if (status === "active") {
    filters.push(sql`${cases.status} <> 'closed'`);
  } else if (status) {
    filters.push(sql`${cases.status} = ${status}`);
  }
  if (severity) filters.push(sql`${cases.severity} = ${severity}`);
  if (classification)
    filters.push(sql`${cases.classification} = ${classification}`);
  if (tlp) filters.push(sql`${cases.tlp} = ${tlp}`);
  if (assignee) filters.push(eq(cases.assigneeId, assignee));
  if (openedSince) {
    const since = new Date(openedSince);
    if (!Number.isNaN(since.getTime())) {
      filters.push(gte(cases.openedAt, since));
    }
  }
  const rows = await db
    .select()
    .from(cases)
    .where(and(...filters))
    .orderBy(desc(cases.openedAt))
    .limit(limit);
  return NextResponse.json({ cases: rows });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const created = await createCaseCore(auth.token.organisationId, null, parsed.data);
  await fireWebhook(auth.token.organisationId, "case.created", {
    case_id: created.id,
    case_number: created.caseNumber,
    title: parsed.data.title,
  });
  return NextResponse.json(
    { id: created.id, caseNumber: created.caseNumber },
    { status: 201 },
  );
}
