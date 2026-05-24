"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { postCommentCore } from "@/lib/comments-core";

export async function postComment(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  await postCommentCore(
    user.organisationId,
    { id: user.id, name: user.name },
    caseId,
    body,
  );
  revalidatePath(`/cases/${caseId}/comments`);
  revalidatePath(`/cases/${caseId}/timeline`);
}
