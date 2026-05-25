import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { organisations, users } from "@/db/schema";

export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session;
}

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "analyst" | "read_only";
  organisationId: string;
  organisationName: string;
  organisationSlug: string;
  timezone: string;
  banned: boolean;
  passwordResetRequired: boolean;
  mfaRequired: boolean;
  twoFactorEnabled: boolean;
};

export async function requireUser(): Promise<CurrentUser> {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  const [u] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!u) {
    redirect("/sign-in");
  }
  if (u.banned) {
    redirect("/sign-in?error=account_locked");
  }
  if (!u.organisationId) {
    redirect("/onboarding");
  }
  const [org] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.id, u.organisationId))
    .limit(1);
  if (!org) {
    redirect("/onboarding");
  }
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    organisationId: org.id,
    organisationName: org.name,
    organisationSlug: org.slug,
    timezone: u.timezone,
    banned: u.banned,
    passwordResetRequired: u.passwordResetRequired,
    mfaRequired: u.mfaRequired,
    twoFactorEnabled: u.twoFactorEnabled,
  };
}

export async function requireRole(
  allowed: Array<"admin" | "analyst" | "read_only">,
): Promise<CurrentUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    throw new Error("Forbidden");
  }
  return user;
}
