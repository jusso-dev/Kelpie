import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiTokens, organisations, users } from "@/db/schema";
import { authenticateMobileRequest } from "@/lib/mobile-auth";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const auth = await authenticateMobileRequest(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }

  const [tokenRow] = await db
    .select({ createdBy: apiTokens.createdBy })
    .from(apiTokens)
    .where(eq(apiTokens.id, auth.token.id))
    .limit(1);

  const [user] = tokenRow?.createdBy
    ? await db
        .select()
        .from(users)
        .where(eq(users.id, tokenRow.createdBy))
        .limit(1)
    : [];

  const [org] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.id, auth.token.organisationId))
    .limit(1);

  return NextResponse.json({
    organisation: org
      ? { id: org.id, name: org.name, slug: org.slug }
      : null,
    token: {
      id: auth.token.id,
      scopes: auth.token.scopes,
    },
    user: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        }
      : null,
  });
}
