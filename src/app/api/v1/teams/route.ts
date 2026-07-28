import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { TeamError, createTeamCore, getTeamCore, listTeamsCore } from "@/lib/teams-core";

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "teams:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const includeInactive = url.searchParams.get("include_inactive") === "true";
  const teams = await listTeamsCore(auth.token.organisationId, { includeInactive });
  return NextResponse.json({ teams });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "teams:write");
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
  const [actor] = auth.token.createdBy
    ? await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, auth.token.createdBy))
        .limit(1)
    : [];
  try {
    const created = await createTeamCore(auth.token.organisationId, actor?.id ?? null, parsed.data);
    const team = await getTeamCore(auth.token.organisationId, created.id);
    return NextResponse.json({ team }, { status: 201 });
  } catch (err) {
    if (err instanceof TeamError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
