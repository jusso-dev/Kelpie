"use client";

import { useEffect } from "react";
import { createTask } from "@/actions/tasks";
import { FieldLock, useCaseCollaboration } from "@/components/case-collaboration";

export default function NewTaskForm({ caseId }: { caseId: string }) {
  const { beginEditing, endEditing, lockedBy } = useCaseCollaboration();
  const locked = lockedBy("new_task");
  useEffect(() => () => endEditing("new_task"), [endEditing]);

  return (
    <form
      action={createTask}
      className="kelpie-card space-y-3 p-5"
      onFocus={() => beginEditing("new_task")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          endEditing("new_task");
        }
      }}
      onSubmit={() => endEditing("new_task")}
    >
      <input type="hidden" name="caseId" value={caseId} />
      <div>
        <h2 className="text-sm font-medium text-slate-300">Add a task</h2>
        <FieldLock field="new_task" />
      </div>
      <fieldset disabled={Boolean(locked)} className="space-y-3 disabled:opacity-60">
        <div>
          <label htmlFor="task-title" className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
            Title
          </label>
          <input id="task-title" name="title" className="kelpie-input" required />
        </div>
        <div>
          <label htmlFor="task-description" className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
            Description
          </label>
          <textarea id="task-description" name="description" className="kelpie-input" rows={3} />
        </div>
        <div>
          <label htmlFor="task-due-at" className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
            Due (optional)
          </label>
          <input id="task-due-at" name="dueAt" className="kelpie-input" type="datetime-local" />
        </div>
        <div className="flex justify-end">
          <button className="kelpie-btn kelpie-btn-primary">Add task</button>
        </div>
      </fieldset>
    </form>
  );
}
