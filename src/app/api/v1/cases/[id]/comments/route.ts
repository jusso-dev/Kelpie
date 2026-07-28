import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { comments, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import {
  authorizeCase,
  canViewSensitiveObject,
  hasPermission,
  REDACTED_PLACEHOLDER,
  resolveTokenActor,
} from "@/lib/access";
import { postCommentCore } from "@/lib/comments-core";

const createSchema = z.object({
  body: z.string().min(1),
  sensitive: z.boolean().optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "comments:read");
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
    .from(comments)
    .where(eq(comments.caseId, id))
    .orderBy(asc(comments.createdAt));

  const redacted = rows.map((row) => {
    if (!row.sensitive) return { ...row, redacted: false };
    let canView = hasPermission(gate.permissions, "view_sensitive");
    if (!canView) {
      canView = canViewSensitiveObject(gate.permissions, {
        sensitive: true,
        objectType: "comment",
        objectId: row.id,
        grants: gate.ctx.grants,
        actor,
      });
    }
    if (canView) return { ...row, redacted: false };
    return { ...row, body: REDACTED_PLACEHOLDER, redacted: true };
  });

  return NextResponse.json({ comments: redacted });
}

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiTokenWithScope(req, "comments:write");
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
  const [userActor] = auth.token.createdBy
    ? await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  const created = await postCommentCore(
    auth.token.organisationId,
    userActor ?? null,
    id,
    parsed.data.body,
    { sensitive: parsed.data.sensitive },
  );
  const [comment] = await db
    .select()
    .from(comments)
    .where(eq(comments.id, created.id))
    .limit(1);
  return NextResponse.json(comment, { status: 201 });
}
