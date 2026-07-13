"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateCaseSummary, type CaseFieldResult } from "@/actions/cases";
import { FieldLock, useCaseCollaboration } from "@/components/case-collaboration";

type Conflict = { mine: string; theirs: string; version: number };

export default function CaseSummaryEditor({
  caseId,
  summary,
  version,
  canEdit,
}: {
  caseId: string;
  summary: string | null;
  version: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary ?? "");
  const [mergeValue, setMergeValue] = useState("");
  const [mergeOpen, setMergeOpen] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pending, startTransition] = useTransition();
  const { beginEditing, endEditing, lockedBy } = useCaseCollaboration();
  const locked = lockedBy("summary");

  useEffect(() => setDraft(summary ?? ""), [summary]);
  useEffect(() => () => endEditing("summary"), [endEditing]);

  function save(value: string, expectedVersion = version) {
    startTransition(async () => {
      const result: CaseFieldResult = await updateCaseSummary(
        caseId,
        value,
        expectedVersion,
      );
      if (!result.ok) {
        const theirs = String(result.conflict.summary ?? "");
        setConflict({
          mine: value,
          theirs,
          version: Number(result.conflict.version),
        });
        setMergeValue(value);
        setMergeOpen(false);
        return;
      }
      setConflict(null);
      setEditing(false);
      endEditing("summary");
      router.refresh();
    });
  }

  function keepTheirs() {
    if (!conflict) return;
    setDraft(conflict.theirs);
    setConflict(null);
    setEditing(false);
    endEditing("summary");
    router.refresh();
  }

  return (
    <div className="kelpie-card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-300">Summary</h2>
        {canEdit && !editing ? (
          <button
            type="button"
            aria-label="Edit summary"
            className="kelpie-btn kelpie-btn-ghost min-h-9 px-3 py-1 text-xs"
            disabled={Boolean(locked)}
            onClick={() => {
              setEditing(true);
              beginEditing("summary");
            }}
          >
            Edit summary
          </button>
        ) : null}
      </div>
      <FieldLock field="summary" />

      {conflict ? (
        <div className="mt-3 space-y-3 rounded border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-100">
          <p role="alert">Another analyst saved the summary while you were editing.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <ConflictValue label="Theirs" value={conflict.theirs} />
            <ConflictValue label="Yours" value={conflict.mine} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="kelpie-btn kelpie-btn-ghost text-xs" onClick={keepTheirs}>
              Keep theirs
            </button>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary text-xs"
              disabled={pending}
              onClick={() => save(conflict.mine, conflict.version)}
            >
              Keep mine
            </button>
            <button type="button" className="kelpie-btn kelpie-btn-secondary text-xs" onClick={() => setMergeOpen(true)}>
              Merge
            </button>
          </div>
          {mergeOpen ? (
            <div className="space-y-2 border-t border-amber-800/60 pt-3">
              <label htmlFor="summary-merge" className="block text-amber-200">Merged summary</label>
              <textarea
                id="summary-merge"
                className="kelpie-input"
                rows={6}
                value={mergeValue}
                onChange={(event) => setMergeValue(event.target.value)}
              />
              <button
                type="button"
                className="kelpie-btn kelpie-btn-primary text-xs"
                disabled={pending}
                onClick={() => save(mergeValue, conflict.version)}
              >
                Save merged summary
              </button>
            </div>
          ) : null}
        </div>
      ) : editing ? (
        <div className="mt-3 space-y-3">
          <label htmlFor="case-summary" className="kelpie-sr-only">Case summary</label>
          <textarea
            id="case-summary"
            className="kelpie-input"
            rows={6}
            value={draft}
            disabled={pending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost"
              disabled={pending}
              onClick={() => {
                setDraft(summary ?? "");
                setEditing(false);
                endEditing("summary");
              }}
            >
              Cancel
            </button>
            <button type="button" className="kelpie-btn kelpie-btn-primary" disabled={pending} onClick={() => save(draft)}>
              {pending ? "Saving…" : "Save summary"}
            </button>
          </div>
        </div>
      ) : (
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">
          {summary || <span className="text-slate-500">No summary yet.</span>}
        </p>
      )}
    </div>
  );
}

function ConflictValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-medium text-amber-300">{label}</p>
      <p className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-amber-50">{value || "Empty"}</p>
    </div>
  );
}
