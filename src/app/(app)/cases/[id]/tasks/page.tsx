import { db } from "@/db";
import { caseTasks, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import TaskRow from "@/components/task-row";
import NewTaskForm from "@/components/new-task-form";

type Props = { params: Promise<{ id: string }> };

export default async function CaseTasksPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const canEdit = user.role === "admin" || user.role === "analyst";
  const tasks = await db
    .select({
      id: caseTasks.id,
      caseId: caseTasks.caseId,
      title: caseTasks.title,
      description: caseTasks.description,
      status: caseTasks.status,
      assigneeId: caseTasks.assigneeId,
      dueAt: caseTasks.dueAt,
      completedAt: caseTasks.completedAt,
      orderIndex: caseTasks.orderIndex,
      playbookRunId: caseTasks.playbookRunId,
      assigneeName: users.name,
    })
    .from(caseTasks)
    .leftJoin(users, eq(users.id, caseTasks.assigneeId))
    .where(eq(caseTasks.caseId, id))
    .orderBy(asc(caseTasks.orderIndex), asc(caseTasks.id));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-2">
        {tasks.length === 0 ? (
          <div className="kelpie-card p-8 text-center text-slate-500 text-sm">
            No tasks on this case. Add one, or start a playbook.
          </div>
        ) : (
          tasks.map((t) => <TaskRow key={t.id} task={t} canEdit={canEdit} />)
        )}
      </div>
      {canEdit ? <div><NewTaskForm caseId={id} /></div> : null}
    </div>
  );
}
