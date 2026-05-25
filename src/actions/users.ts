"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { accounts, sessions, twoFactors, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { sendEmail } from "@/lib/email";

const ROLES = ["admin", "analyst", "read_only"] as const;
type Role = (typeof ROLES)[number];

function randomPassword(): string {
  return `Kelp-${crypto.randomBytes(9).toString("base64url")}-9`;
}

function pickRole(raw: FormDataEntryValue | null): Role {
  const value = String(raw ?? "analyst");
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : "analyst";
}

async function loadManagedUser(userId: string, organisationId: string) {
  const [target] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  if (!target) throw new Error("User not found in this organisation");
  return target;
}

async function setCredentialPassword(userId: string, email: string, password: string) {
  const passwordHash = await hashPassword(password);
  const [existing] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "credential")))
    .limit(1);

  if (existing) {
    await db
      .update(accounts)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(accounts.id, existing.id));
    return;
  }

  await db.insert(accounts).values({
    id: newId("acct"),
    userId,
    accountId: email,
    providerId: "credential",
    password: passwordHash,
  });
}

export async function inviteUser(formData: FormData) {
  const actor = await requireRole(["admin"]);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const role = pickRole(formData.get("role"));
  if (!email || !name) throw new Error("Name and email are required");

  const existing = await db
    .select({ id: users.id, organisationId: users.organisationId })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing[0]?.organisationId) {
    throw new Error("A user with this email already belongs to an organisation");
  }

  const password = randomPassword();
  const userId = existing[0]?.id ?? newId("usr");

  if (existing[0]) {
    await db
      .update(users)
      .set({
        name,
        organisationId: actor.organisationId,
        role,
        emailVerified: true,
        passwordResetRequired: true,
        invitedAt: new Date(),
        invitedBy: actor.id,
        banned: false,
        banReason: null,
        banExpires: null,
        lockedAt: null,
      })
      .where(eq(users.id, userId));
  } else {
    await db.insert(users).values({
      id: userId,
      name,
      email,
      emailVerified: true,
      organisationId: actor.organisationId,
      role,
      passwordResetRequired: true,
      invitedAt: new Date(),
      invitedBy: actor.id,
    });
  }

  await setCredentialPassword(userId, email, password);
  await sendEmail({
    to: email,
    subject: `[Kelpie] ${actor.organisationName} invited you`,
    text:
      `${actor.name} invited you to Kelpie for ${actor.organisationName}.\n\n` +
      `Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/sign-in\n` +
      `Email: ${email}\nTemporary password: ${password}\n\n` +
      "Change this password after your first sign-in.",
  });
  revalidatePath("/settings");
}

export async function setUserRole(formData: FormData) {
  const actor = await requireRole(["admin"]);
  const userId = String(formData.get("userId") ?? "");
  const role = pickRole(formData.get("role"));
  if (userId === actor.id && role !== "admin") {
    throw new Error("You cannot remove your own administrator role");
  }
  await loadManagedUser(userId, actor.organisationId);
  await db.update(users).set({ role }).where(eq(users.id, userId));
  revalidatePath("/settings");
}

export async function lockUser(formData: FormData) {
  const actor = await requireRole(["admin"]);
  const userId = String(formData.get("userId") ?? "");
  const reason = String(formData.get("reason") ?? "Locked by organisation administrator").trim();
  if (userId === actor.id) throw new Error("You cannot lock your own account");
  await loadManagedUser(userId, actor.organisationId);
  await db
    .update(users)
    .set({
      banned: true,
      banReason: reason || "Locked by organisation administrator",
      lockedAt: new Date(),
    })
    .where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  revalidatePath("/settings");
}

export async function unlockUser(formData: FormData) {
  const actor = await requireRole(["admin"]);
  const userId = String(formData.get("userId") ?? "");
  await loadManagedUser(userId, actor.organisationId);
  await db
    .update(users)
    .set({ banned: false, banReason: null, banExpires: null, lockedAt: null })
    .where(eq(users.id, userId));
  revalidatePath("/settings");
}

export async function resetUserPassword(formData: FormData) {
  const actor = await requireRole(["admin"]);
  const userId = String(formData.get("userId") ?? "");
  const target = await loadManagedUser(userId, actor.organisationId);
  const password = randomPassword();
  await setCredentialPassword(target.id, target.email, password);
  await db
    .update(users)
    .set({
      passwordResetRequired: true,
      lastPasswordResetAt: new Date(),
    })
    .where(eq(users.id, target.id));
  await db.delete(sessions).where(eq(sessions.userId, target.id));
  await sendEmail({
    to: target.email,
    subject: "[Kelpie] Your password was reset",
    text:
      `${actor.name} reset your Kelpie password.\n\n` +
      `Sign in at ${process.env.APP_URL ?? "http://localhost:3000"}/sign-in\n` +
      `Temporary password: ${password}\n\n` +
      "Change this password after your next sign-in.",
  });
  revalidatePath("/settings");
}

export async function setMfaRequired(formData: FormData) {
  const actor = await requireRole(["admin"]);
  const userId = String(formData.get("userId") ?? "");
  const required = formData.get("required") === "true";
  await loadManagedUser(userId, actor.organisationId);
  await db.update(users).set({ mfaRequired: required }).where(eq(users.id, userId));
  revalidatePath("/settings");
}

export async function resetUserMfa(formData: FormData) {
  const actor = await requireRole(["admin"]);
  const userId = String(formData.get("userId") ?? "");
  await loadManagedUser(userId, actor.organisationId);
  await db.delete(twoFactors).where(eq(twoFactors.userId, userId));
  await db
    .update(users)
    .set({ twoFactorEnabled: false, mfaRequired: true })
    .where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  revalidatePath("/settings");
}
