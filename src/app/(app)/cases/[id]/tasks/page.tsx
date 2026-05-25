import { db } from "@/db";
import { caseTasks, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { createTask } from "@/actions/tasks";
import TaskRow from "@/components/task-row";

type Props = { params: Promise<{ id: string }> };

export default async function CaseTasksPage({ params }: Props) {
  const { id } = await params;
  await requireUser();
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
          tasks.map((t) => <TaskRow key={t.id} task={t} />)
        )}
      </div>
      <div>
        <form action={createTask} className="kelpie-card p-5 space-y-3">
          <input type="hidden" name="caseId" value={id} />
          <h2 className="text-sm font-medium text-slate-300">Add a task</h2>
          <div>
            <label
              htmlFor="task-title"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Title
            </label>
            <input id="task-title" name="title" className="kelpie-input" required />
          </div>
          <div>
            <label
              htmlFor="task-description"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Description
            </label>
            <textarea id="task-description" name="description" className="kelpie-input" rows={3} />
          </div>
          <div>
            <label
              htmlFor="task-due-at"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Due (optional)
            </label>
            <input id="task-due-at" name="dueAt" className="kelpie-input" type="datetime-local" />
          </div>
          <div className="flex justify-end">
            <button className="kelpie-btn kelpie-btn-primary">Add task</button>
          </div>
        </form>
      </div>
    </div>
  );
}
