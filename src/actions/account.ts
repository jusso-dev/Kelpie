"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/session";

type PasswordChangeState = {
  ok: boolean;
  error: string | null;
};

export async function changeOwnPassword(
  _state: PasswordChangeState,
  formData: FormData,
): Promise<PasswordChangeState> {
  const user = await requireUser();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword || !newPassword || !confirmPassword) {
    return { ok: false, error: "All password fields are required" };
  }
  if (newPassword !== confirmPassword) {
    return { ok: false, error: "New passwords do not match" };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters" };
  }

  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Could not change password";
    return { ok: false, error: message };
  }

  await db
    .update(users)
    .set({
      passwordResetRequired: false,
      lastPasswordResetAt: new Date(),
    })
    .where(eq(users.id, user.id));

  revalidatePath("/", "layout");
  return { ok: true, error: null };
}
