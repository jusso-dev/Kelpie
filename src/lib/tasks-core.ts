import { db } from "@/db";
import { caseTasks, cases } from "@/db/schema";
import { and, eq, max } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";

const STATUS_VALUES = ["todo", "in_progress", "done", "blocked"] as const;
export type TaskStatus = (typeof STATUS_VALUES)[number];

export const TASK_STATUS_VALUES = STATUS_VALUES;

async function loadTaskInOrg(taskId: string, organisationId: string) {
  const [t] = await db
    .select({
      task: caseTasks,
      organisationId: cases.organisationId,
    })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(and(eq(caseTasks.id, taskId), eq(cases.organisationId, organisationId)))
    .limit(1);
  return t?.task ?? null;
}

async function assertCaseInOrg(caseId: string, organisationId: string) {
  const [c] = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");
}

export async function createTaskCore(
  organisationId: string,
  actorId: string | null,
  caseId: string,
  input: {
    title: string;
    description?: string | null;
    assigneeId?: string | null;
    dueAt?: Date | null;
  },
): Promise<{ id: string }> {
  if (!input.title.trim()) throw new Error("Title required");
  await assertCaseInOrg(caseId, organisationId);
  const [{ value: maxOrder }] = await db
    .select({ value: max(caseTasks.orderIndex) })
    .from(caseTasks)
    .where(eq(caseTasks.caseId, caseId));
  const id = newId("task");
  await db.insert(caseTasks).values({
    id,
    caseId,
    title: input.title.trim(),
    description: input.description ?? null,
    assigneeId: input.assigneeId ?? null,
    orderIndex: (maxOrder ?? 0) + 1,
    dueAt: input.dueAt ?? null,
  });
  await writeTimelineEvent({
    caseId,
    actorId,
    eventType: "task_created",
    payload: { task_id: id, title: input.title },
  });
  return { id };
}

export async function patchTaskCore(
  organisationId: string,
  actorId: string | null,
  taskId: string,
  patch: {
    status?: TaskStatus;
    assigneeId?: string | null;
    dueAt?: Date | null;
    title?: string;
    description?: string | null;
  },
): Promise<{ caseId: string }> {
  const existing = await loadTaskInOrg(taskId, organisationId);
  if (!existing) throw new Error("Task not found");

  const set: Partial<typeof caseTasks.$inferInsert> = {};
  let eventType: "task_updated" | "task_completed" = "task_updated";
  if (patch.status && patch.status !== existing.status) {
    set.status = patch.status;
    if (patch.status === "done") {
      set.completedAt = new Date();
      set.completedBy = actorId;
      eventType = "task_completed";
    } else if (existing.status === "done") {
      set.completedAt = null;
      set.completedBy = null;
    }
  }
  if (patch.assigneeId !== undefined) set.assigneeId = patch.assigneeId;
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt;
  if (patch.title !== undefined && patch.title.trim()) set.title = patch.title.trim();
  if (patch.description !== undefined) set.description = patch.description;
  if (Object.keys(set).length === 0) return { caseId: existing.caseId };

  await db.update(caseTasks).set(set).where(eq(caseTasks.id, taskId));
  await writeTimelineEvent({
    caseId: existing.caseId,
    actorId,
    eventType,
    payload: {
      task_id: taskId,
      from: existing.status,
      to: patch.status ?? existing.status,
      title: set.title ?? existing.title,
    },
  });
  return { caseId: existing.caseId };
}
