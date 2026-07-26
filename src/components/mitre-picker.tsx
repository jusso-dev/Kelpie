"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateMitreTechniques } from "@/actions/cases";
import type { MitreTechnique } from "@/data/mitre";
import { FieldLock, useCaseCollaboration } from "@/components/case-collaboration";
import { feedbackError } from "@/components/confirm-dialog";

export default function MitrePicker({
  caseId,
  version,
  canEdit,
  selected,
  techniques,
}: {
  caseId: string;
  version: number;
  canEdit: boolean;
  selected: string[];
  techniques: MitreTechnique[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string[]>(selected);
  const [pending, start] = useTransition();
  const [conflict, setConflict] = useState<{
    mine: string[];
    theirs: string[];
    version: number;
  } | null>(null);
  const router = useRouter();
  const { beginEditing, endEditing, lockedBy } = useCaseCollaboration();
  const locked = lockedBy("mitreTechniques");
  useEffect(() => () => endEditing("mitreTechniques"), [endEditing]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return techniques.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        t.tactic.toLowerCase().includes(q),
    );
  }, [query, techniques]);

  function toggle(id: string) {
    setCurrent((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function save(value = current, expectedVersion = version) {
    start(async () => {
      try {
        const result = await updateMitreTechniques(caseId, value, expectedVersion);
        if (!result.ok) {
          setConflict({
            mine: value,
            theirs: Array.isArray(result.conflict.mitreTechniques)
              ? (result.conflict.mitreTechniques as string[])
              : [],
            version: Number(result.conflict.version),
          });
          toast.warning("Techniques changed elsewhere", {
            description: "Review both selections before deciding what to keep.",
          });
          return;
        }
        setConflict(null);
        setOpen(false);
        endEditing("mitreTechniques");
        toast.success("MITRE techniques saved", {
          description: "The case record now shows the updated technique mapping.",
        });
        router.refresh();
      } catch (error) {
        toast.error("MITRE techniques could not be saved", {
          description: feedbackError(
            error,
            "Your selection is still here. Refresh the case and try again.",
          ),
        });
      }
    });
  }

  if (!open) {
    return (
      <div>
        <button
          className="kelpie-btn kelpie-btn-secondary"
          disabled={!canEdit || Boolean(locked)}
          title={!canEdit ? "Your role cannot edit techniques" : undefined}
          onClick={() => {
            setOpen(true);
            beginEditing("mitreTechniques");
          }}
        >
          Edit techniques
        </button>
        <FieldLock field="mitreTechniques" />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conflict ? (
        <div className="kelpie-notice kelpie-notice-warning kelpie-notice-block space-y-2">
          <p role="alert">Another analyst changed the MITRE techniques while you were editing.</p>
          <p><span className="text-amber-300">Theirs:</span> {conflict.theirs.join(", ") || "None"}</p>
          <p><span className="text-amber-300">Yours:</span> {conflict.mine.join(", ") || "None"}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost text-xs"
              onClick={() => {
                setCurrent(conflict.theirs);
                setConflict(null);
                setOpen(false);
                endEditing("mitreTechniques");
                router.refresh();
              }}
            >
              Keep theirs
            </button>
            <button type="button" className="kelpie-btn kelpie-btn-secondary text-xs" disabled={pending} onClick={() => save(conflict.mine, conflict.version)}>
              Keep mine
            </button>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-primary text-xs"
              disabled={pending}
              onClick={() => save([...new Set([...conflict.theirs, ...conflict.mine])], conflict.version)}
            >
              Merge both
            </button>
          </div>
        </div>
      ) : null}
      <label htmlFor="mitre-search" className="kelpie-sr-only">
        Search MITRE techniques
      </label>
      <input
        id="mitre-search"
        className="kelpie-input"
        placeholder="Search by ID, name, or tactic..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="max-h-72 overflow-y-auto border border-[color:var(--color-navy-700)] rounded">
        {filtered.map((t) => {
          const checked = current.includes(t.id);
          return (
            <label
              key={t.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-[color:var(--color-navy-800)]"
            >
              <input
                type="checkbox"
                className="kelpie-checkbox"
                checked={checked}
                onChange={() => toggle(t.id)}
              />
              <span className="font-mono text-xs text-slate-400 w-20">
                {t.id}
              </span>
              <span className="text-slate-200 flex-1">{t.name}</span>
              <span className="text-xs text-slate-500">{t.tactic}</span>
            </label>
          );
        })}
      </div>
      <div className="flex gap-2 justify-end">
        <button
          className="kelpie-btn kelpie-btn-ghost"
          onClick={() => {
            setCurrent(selected);
            setOpen(false);
            setConflict(null);
            endEditing("mitreTechniques");
          }}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          className="kelpie-btn kelpie-btn-primary"
          onClick={() => save()}
          disabled={pending}
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
