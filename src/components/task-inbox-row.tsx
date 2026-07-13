"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import { AlertTriangle, CalendarClock, UserRound } from "lucide-react";
import { setTaskStatus } from "@/actions/tasks";
import { SeverityBadge, TaskStatusBadge } from "@/components/badges";

const STATUSES = ["todo", "in_progress", "done", "blocked"] as const;

type TaskStatus = (typeof STATUSES)[number];

type InboxTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueAt: Date | null;
  dueState: "overdue" | "soon" | "later" | "none" | "done";
  assigneeName: string | null;
  caseId: string;
  caseNumber: string;
  caseTitle: string;
  caseSeverity: string;
};

export default function TaskInboxRow({
  task,
  canEdit,
}: {
  task: InboxTask;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState(task.status);
  const [error, setError] = useState<string | null>(null);

  function changeStatus(next: TaskStatus) {
    const previous = status;
    setStatus(next);
    setError(null);
    startTransition(async () => {
      try {
        await setTaskStatus(task.id, next);
        router.refresh();
      } catch {
        setStatus(previous);
        setError("Could not update this task. Try again.");
      }
    });
  }

  return (
    <article className="kelpie-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskStatusBadge value={status} />
            <SeverityBadge value={task.caseSeverity} />
            {task.dueState === "overdue" ? (
              <span className="kelpie-badge text-red-400">
                <AlertTriangle size={12} aria-hidden="true" />
                overdue
              </span>
            ) : task.dueState === "soon" ? (
              <span className="kelpie-badge text-amber-300">due soon</span>
            ) : null}
          </div>
          <h2 className="mt-3 text-base font-semibold text-slate-50">
            {task.title}
          </h2>
          {task.description ? (
            <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-400">
              {task.description}
            </p>
          ) : null}
          <div className="mt-3 flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:flex-wrap sm:gap-x-5">
            <Link href={`/cases/${task.caseId}`} className="kelpie-link font-medium">
              <span className="font-mono">{task.caseNumber}</span>
              <span className="ml-2">{task.caseTitle}</span>
            </Link>
            <span className="inline-flex items-center gap-1.5">
              <UserRound size={14} aria-hidden="true" />
              {task.assigneeName ?? "Unassigned"}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CalendarClock size={14} aria-hidden="true" />
              {task.dueAt ? (
                <>
                  Due {format(task.dueAt, "PP p")} ·{" "}
                  {task.dueAt > new Date() ? "in " : ""}
                  {formatDistanceToNowStrict(task.dueAt)}
                  {task.dueAt < new Date() ? " ago" : ""}
                </>
              ) : (
                "No due date"
              )}
            </span>
          </div>
          {error ? (
            <p className="mt-3 text-xs text-red-300" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <label className="text-xs font-medium text-slate-300 md:w-44">
          Status
          <select
            className="kelpie-input mt-1 capitalize"
            aria-label={`Status for task ${task.title}`}
            value={status}
            disabled={pending || !canEdit}
            title={canEdit ? undefined : "Your role cannot update tasks"}
            onChange={(event) => changeStatus(event.target.value as TaskStatus)}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
    </article>
  );
}
