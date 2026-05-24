"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  createTaskCore,
  patchTaskCore,
  TASK_STATUS_VALUES,
} from "@/lib/tasks-core";
import { db } from "@/db";
import { caseTasks } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function createTask(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const title = String(formData.get("title") ?? "");
  const description = String(formData.get("description") ?? "");
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  await createTaskCore(user.organisationId, user.id, caseId, {
    title,
    description: description || null,
    dueAt: dueRaw ? new Date(dueRaw) : null,
  });
  revalidatePath(`/cases/${caseId}/tasks`);
}

export async function setTaskStatus(taskId: string, next: string) {
  const user = await requireRole(["admin", "analyst"]);
  if (!(TASK_STATUS_VALUES as readonly string[]).includes(next)) {
    throw new Error("Invalid status");
  }
  await patchTaskCore(user.organisationId, user.id, taskId, {
    status: next as (typeof TASK_STATUS_VALUES)[number],
  });
  const [t] = await db
    .select({ caseId: caseTasks.caseId })
    .from(caseTasks)
    .where(eq(caseTasks.id, taskId))
    .limit(1);
  if (t) {
    revalidatePath(`/cases/${t.caseId}/tasks`);
    revalidatePath(`/cases/${t.caseId}`);
  }
}
