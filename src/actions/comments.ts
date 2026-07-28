"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { authorizeCase, resolveUserActor } from "@/lib/access";
import { postCommentCore } from "@/lib/comments-core";

export async function postComment(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) throw new Error("Not found");
  const gate = await authorizeCase(user.organisationId, caseId, actor, "edit");
  if (!gate.ok) throw new Error(gate.error);
  await postCommentCore(
    user.organisationId,
    { id: user.id, name: user.name },
    caseId,
    body,
  );
  revalidatePath(`/cases/${caseId}/comments`);
  revalidatePath(`/cases/${caseId}/timeline`);
}
