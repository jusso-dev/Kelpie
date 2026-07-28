import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { createTeamCore, listTeamsCore } from "@/lib/queues-core";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "queues:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const teams = await listTeamsCore(auth.token.organisationId);
  return NextResponse.json({ teams });
}

export async function POST(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "queues:write");
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
  try {
    const result = await createTeamCore(
      auth.token.organisationId,
      auth.token.createdBy ?? null,
      parsed.data.name,
      parsed.data.description,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create team" },
      { status: 400 },
    );
  }
}
