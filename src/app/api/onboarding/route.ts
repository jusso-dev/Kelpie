import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { organisations, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId, slugify } from "@/lib/utils";

export async function POST(req: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    organisationName?: string;
  };
  if (!body.organisationName) {
    return NextResponse.json(
      { error: "organisationName required" },
      { status: 400 },
    );
  }

  // If the user already has an organisation, do nothing.
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (existing?.organisationId) {
    return NextResponse.json({ organisationId: existing.organisationId });
  }

  const orgId = newId("org");
  const baseSlug = slugify(body.organisationName) || "org";
  const slug = `${baseSlug}-${orgId.slice(-6)}`;
  await db.insert(organisations).values({
    id: orgId,
    name: body.organisationName,
    slug,
  });
  await db
    .update(users)
    .set({ organisationId: orgId, role: "admin" })
    .where(eq(users.id, session.user.id));

  return NextResponse.json({ organisationId: orgId });
}
