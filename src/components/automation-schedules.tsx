"use client";

import { useState } from "react";
import { Clock3 } from "lucide-react";
import { toast } from "sonner";
import { updateFeedSchedule } from "@/actions/ti";
import { updateCaseSourceSchedule } from "@/actions/case-sources";
import { feedbackError } from "@/components/confirm-dialog";

export type AutomationJob = {
  id: string;
  kind: "threat_intelligence" | "case_source";
  name: string;
  intervalMinutes: number;
  isActive: boolean;
  lastRunAt: string | null;
  lastError: string | null;
};

function formatRun(value: string | null) {
  if (!value) return "Not run yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function ScheduleRow({
  job,
  canEdit,
}: {
  job: AutomationJob;
  canEdit: boolean;
}) {
  const [interval, setInterval] = useState(String(job.intervalMinutes));
  const [active, setActive] = useState(job.isActive);
  const [pending, setPending] = useState(false);

  async function save() {
    const minutes = Number(interval);
    const minimum = job.kind === "threat_intelligence" ? 5 : 1;
    if (!Number.isInteger(minutes) || minutes < minimum || minutes > 10080) {
      toast.warning("Schedule needs attention", {
        description: `Use a whole number between ${minimum} and 10,080 minutes.`,
      });
      return;
    }
    setPending(true);
    try {
      if (job.kind === "threat_intelligence") {
        await updateFeedSchedule(job.id, minutes, active);
      } else {
        await updateCaseSourceSchedule(job.id, minutes, active);
      }
      toast.success("Schedule saved", {
        description: active
          ? `${job.name} will run about every ${minutes} minute${minutes === 1 ? "" : "s"}.`
          : `${job.name} is paused. Its existing data remains available.`,
      });
    } catch (error) {
      toast.error("Schedule could not be saved", {
        description: feedbackError(
          error,
          "Nothing changed. Check the interval and try again.",
        ),
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <article className="grid gap-4 border-b border-[color:var(--color-navy-700)] p-4 last:border-b-0 lg:grid-cols-[minmax(14rem,1fr)_minmax(12rem,.8fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-medium text-slate-200">{job.name}</h3>
          <span className="kelpie-badge">
            {job.kind === "threat_intelligence" ? "TI enrichment" : "case import"}
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Last run: {formatRun(job.lastRunAt)}
        </p>
        {job.lastError ? (
          <p className="mt-1 line-clamp-2 text-xs text-red-400" title={job.lastError}>
            Last run failed: {job.lastError}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-[minmax(7rem,1fr)_auto] items-end gap-3">
        <div className="kelpie-field">
          <label className="kelpie-label" htmlFor={`schedule-${job.kind}-${job.id}`}>
            Every (minutes)
          </label>
          <input
            id={`schedule-${job.kind}-${job.id}`}
            className="kelpie-input"
            type="number"
            inputMode="numeric"
            min={job.kind === "threat_intelligence" ? 5 : 1}
            max={10080}
            step={1}
            value={interval}
            onChange={(event) => setInterval(event.target.value)}
            disabled={!canEdit || pending}
          />
        </div>
        <label className="flex h-10 items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            disabled={!canEdit || pending}
          />
          Active
        </label>
      </div>
      {canEdit ? (
        <button
          type="button"
          className="kelpie-btn kelpie-btn-secondary justify-center"
          onClick={() => void save()}
          disabled={pending}
        >
          {pending ? "Saving…" : "Save schedule"}
        </button>
      ) : null}
    </article>
  );
}

export default function AutomationSchedules({
  jobs,
  canEdit,
}: {
  jobs: AutomationJob[];
  canEdit: boolean;
}) {
  if (jobs.length === 0) {
    return (
      <div className="kelpie-empty">
        <Clock3 size={20} aria-hidden="true" />
        <p>Add a TI feed or case source before creating a schedule.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-[color:var(--color-navy-700)]">
      {jobs.map((job) => (
        <ScheduleRow key={`${job.kind}-${job.id}`} job={job} canEdit={canEdit} />
      ))}
    </div>
  );
}
