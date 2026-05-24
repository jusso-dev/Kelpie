"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cases, caseTasks } from "@/db/schema";
import { and, eq, max } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";

async function assertCaseAccess(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");
}

export async function createTask(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const dueRaw = String(formData.get("dueAt") ?? "").trim();
  if (!caseId || !title) throw new Error("caseId and title are required");
  await assertCaseAccess(caseId, user.organisationId);

  const [{ value: maxOrder }] = await db
    .select({ value: max(caseTasks.orderIndex) })
    .from(caseTasks)
    .where(eq(caseTasks.caseId, caseId));

  const id = newId("task");
  await db.insert(caseTasks).values({
    id,
    caseId,
    title,
    description: description || null,
    orderIndex: (maxOrder ?? 0) + 1,
    dueAt: dueRaw ? new Date(dueRaw) : null,
  });
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "task_created",
    payload: { task_id: id, title },
  });
  revalidatePath(`/cases/${caseId}/tasks`);
}

export async function setTaskStatus(taskId: string, next: string) {
  const user = await requireRole(["admin", "analyst"]);
  const [t] = await db
    .select()
    .from(caseTasks)
    .where(eq(caseTasks.id, taskId))
    .limit(1);
  if (!t) throw new Error("Task not found");
  await assertCaseAccess(t.caseId, user.organisationId);

  const allowed = ["todo", "in_progress", "done", "blocked"] as const;
  if (!(allowed as readonly string[]).includes(next)) {
    throw new Error("Invalid status");
  }
  const patch: Partial<typeof caseTasks.$inferInsert> = {
    status: next as (typeof allowed)[number],
  };
  if (next === "done") {
    patch.completedAt = new Date();
    patch.completedBy = user.id;
  } else if (t.status === "done") {
    patch.completedAt = null;
    patch.completedBy = null;
  }
  await db.update(caseTasks).set(patch).where(eq(caseTasks.id, taskId));
  await writeTimelineEvent({
    caseId: t.caseId,
    actorId: user.id,
    eventType: next === "done" ? "task_completed" : "task_updated",
    payload: { task_id: taskId, from: t.status, to: next, title: t.title },
  });
  revalidatePath(`/cases/${t.caseId}/tasks`);
  revalidatePath(`/cases/${t.caseId}`);
}
