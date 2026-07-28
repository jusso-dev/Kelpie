import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  addWatcherCore,
  listWatchersCore,
  removeWatcherCore,
} from "@/lib/watchers-core";

const addSchema = z.object({
  userId: z.string().trim().min(1),
  notifyOnComment: z.boolean().optional(),
  notifyOnStatusChange: z.boolean().optional(),
  notifyOnAssignment: z.boolean().optional(),
  notifyOnSlaRisk: z.boolean().optional(),
});

async function requireCaseInOrg(organisationId: string, caseId: string) {
  const [row] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return Boolean(row);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await requireCaseInOrg(auth.token.organisationId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const watchers = await listWatchersCore(auth.token.organisationId, id);
  return NextResponse.json({ watchers });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const body = await req.json().catch(() => null);
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const { userId, ...preferences } = parsed.data;
    await addWatcherCore(
      auth.token.organisationId,
      auth.token.createdBy ?? null,
      id,
      userId,
      preferences,
    );
    const watchers = await listWatchersCore(auth.token.organisationId, id);
    return NextResponse.json({ watchers }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not add watcher" },
      { status: 400 },
    );
  }
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "cases:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query parameter is required" }, { status: 400 });
  }
  if (!(await requireCaseInOrg(auth.token.organisationId, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  await removeWatcherCore(auth.token.organisationId, id, userId);
  return NextResponse.json({ ok: true });
}
