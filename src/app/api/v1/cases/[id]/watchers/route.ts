import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { cases, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { WatcherError, addWatcherCore, listWatchersCore } from "@/lib/watchers-core";

const preferencesSchema = z
  .object({
    notifyOnComment: z.boolean().optional(),
    notifyOnStatusChange: z.boolean().optional(),
    notifyOnAssignment: z.boolean().optional(),
    notifyOnEscalation: z.boolean().optional(),
  })
  .optional();

const createSchema = z.object({
  userId: z.string().min(1),
  preferences: preferencesSchema,
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
  const auth = await authenticateApiTokenWithScope(req, "watchers:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!(await caseInOrg(id, auth.token.organisationId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const watchers = await listWatchersCore(auth.token.organisationId, id);
  return NextResponse.json({ watchers });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "watchers:write");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const { id } = await context.params;
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
    const watcher = await addWatcherCore(
      auth.token.organisationId,
      actor?.id ?? null,
      id,
      parsed.data.userId,
      parsed.data.preferences,
    );
    return NextResponse.json({ watcher }, { status: 201 });
  } catch (err) {
    if (err instanceof WatcherError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
