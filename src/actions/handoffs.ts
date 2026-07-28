"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { createHandoffCore, type CreateHandoffInput } from "@/lib/handoffs-core";

export async function createHandoff(
  caseId: string,
  input: CreateHandoffInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireRole(["admin", "analyst"]);
  try {
    const result = await createHandoffCore(user.organisationId, user.id, caseId, input);
    revalidatePath(`/cases/${caseId}`);
    return { ok: true, id: result.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed" };
  }
}
