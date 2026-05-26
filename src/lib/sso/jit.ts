import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/utils";
import type { SsoRole } from "./config";

/**
 * Just-in-time provisioning shared by the SAML and OIDC flows. On first sign in
 * a user record is created inside the organisation; on subsequent sign ins the
 * name and role are refreshed from the assertion.
 */
export async function provisionSsoUser(opts: {
  organisationId: string;
  email: string;
  name: string;
  role: SsoRole;
}): Promise<{ userId: string }> {
  const email = opts.email.trim().toLowerCase();
  if (!email) throw new Error("SSO assertion did not include an email");
  const name = opts.name.trim() || email;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    if (existing.organisationId && existing.organisationId !== opts.organisationId) {
      throw new Error("This email already belongs to a different organisation");
    }
    await db
      .update(users)
      .set({
        name,
        role: opts.role,
        organisationId: opts.organisationId,
        emailVerified: true,
        banned: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    return { userId: existing.id };
  }

  const id = newId("user");
  await db.insert(users).values({
    id,
    name,
    email,
    emailVerified: true,
    organisationId: opts.organisationId,
    role: opts.role,
  });
  return { userId: id };
}
