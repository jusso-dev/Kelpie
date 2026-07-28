"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { resolveIntegrationConflict } from "@/actions/integrations";

export type SyncConflictRow = {
  id: string;
  connectionKind: string;
  connectionId: string;
  caseId: string | null;
  fieldName: string;
  kelpieValue: unknown;
  sourceValue: unknown;
  kelpieUpdatedAt: string | null;
  sourceUpdatedAt: string | null;
  kelpieProvenance: string | null;
  sourceProvenance: string | null;
  createdAt: string;
};

export type SyncConflictQueueProps = {
  conflicts: SyncConflictRow[];
  canResolve: boolean;
};

function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function SyncConflictQueue({
  conflicts,
  canResolve,
}: SyncConflictQueueProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function resolve(
    id: string,
    resolution: "resolved_keep_kelpie" | "resolved_take_source" | "dismissed",
  ) {
    startTransition(async () => {
      try {
        await resolveIntegrationConflict(id, resolution);
        toast.success("Conflict resolved");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Resolve failed");
      }
    });
  }

  if (conflicts.length === 0) {
    return (
      <p className="text-sm text-slate-500">No open sync conflicts.</p>
    );
  }

  return (
    <ul className="space-y-3">
      {conflicts.map((c) => (
        <li
          key={c.id}
          className="rounded-lg border border-[color:var(--color-navy-700)] p-4"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-300">{c.fieldName}</span>
            <span>·</span>
            <span>
              {c.connectionKind}/{c.connectionId}
            </span>
            {c.caseId ? (
              <>
                <span>·</span>
                <Link
                  href={`/cases/${c.caseId}`}
                  className="text-[color:var(--color-tan-400)] hover:underline"
                >
                  open case
                </Link>
              </>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded border border-[color:var(--color-navy-800)] p-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Kelpie ({c.kelpieProvenance ?? "kelpie"})
              </p>
              <p className="mt-1 break-words text-sm text-slate-200">
                {fmtValue(c.kelpieValue)}
              </p>
              <p className="mt-1 text-[11px] text-slate-600">
                {c.kelpieUpdatedAt
                  ? new Date(c.kelpieUpdatedAt).toLocaleString()
                  : "unknown time"}
              </p>
            </div>
            <div className="rounded border border-[color:var(--color-navy-800)] p-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Source ({c.sourceProvenance ?? "source"})
              </p>
              <p className="mt-1 break-words text-sm text-slate-200">
                {fmtValue(c.sourceValue)}
              </p>
              <p className="mt-1 text-[11px] text-slate-600">
                {c.sourceUpdatedAt
                  ? new Date(c.sourceUpdatedAt).toLocaleString()
                  : "unknown time"}
              </p>
            </div>
          </div>
          {canResolve ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost text-xs"
                disabled={pending}
                onClick={() => resolve(c.id, "resolved_keep_kelpie")}
              >
                Keep Kelpie
              </button>
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost text-xs"
                disabled={pending}
                onClick={() => resolve(c.id, "resolved_take_source")}
              >
                Take source
              </button>
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost text-xs"
                disabled={pending}
                onClick={() => resolve(c.id, "dismissed")}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
