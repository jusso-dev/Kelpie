"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTaskStatus } from "@/actions/tasks";
import { TaskStatusBadge } from "@/components/badges";
import { format, formatDistanceToNowStrict, isPast } from "date-fns";

type Task = {
  id: string;
  caseId: string;
  title: string;
  description: string | null;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  orderIndex: number;
  playbookRunId: string | null;
};

const STATUSES = ["todo", "in_progress", "done", "blocked"];

export default function TaskRow({
  task,
  canEdit = true,
}: {
  task: Task;
  canEdit?: boolean;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const overdue =
    task.dueAt && task.status !== "done" && isPast(task.dueAt);
  const dueSoon =
    task.dueAt &&
    task.status !== "done" &&
    !overdue &&
    task.dueAt.getTime() - Date.now() < 60 * 60 * 1000;

  function change(next: string) {
    start(async () => {
      await setTaskStatus(task.id, next);
      router.refresh();
    });
  }

  return (
    <div className="kelpie-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-slate-100">{task.title}</span>
            <TaskStatusBadge value={task.status} />
            {task.playbookRunId ? (
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                from playbook
              </span>
            ) : null}
            {overdue ? (
              <span className="text-[10px] uppercase tracking-wider text-red-400">
                overdue
              </span>
            ) : null}
            {dueSoon ? (
              <span className="text-[10px] uppercase tracking-wider text-amber-400">
                due soon
              </span>
            ) : null}
          </div>
          {task.description ? (
            <p className="text-sm text-slate-300 mt-1 whitespace-pre-wrap">
              {task.description}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500 sm:gap-4">
            {task.dueAt ? (
              <span>
                Due {format(task.dueAt, "PP p")} (
                {task.dueAt > new Date() ? "in " : ""}
                {formatDistanceToNowStrict(task.dueAt)}
                {task.dueAt < new Date() ? " ago" : ""})
              </span>
            ) : (
              <span>No due date</span>
            )}
            {task.assigneeName ? <span>Assignee {task.assigneeName}</span> : null}
            {task.completedAt ? (
              <span>Done {format(task.completedAt, "PP p")}</span>
            ) : null}
          </div>
        </div>
        <select
          className="kelpie-input w-full sm:max-w-[10rem]"
          aria-label={`Status for task ${task.title}`}
          value={task.status}
          disabled={pending || !canEdit}
          title={canEdit ? undefined : "Your role cannot update tasks"}
          onChange={(e) => change(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
