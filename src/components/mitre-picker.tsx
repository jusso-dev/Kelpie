"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMitreTechniques } from "@/actions/cases";
import type { MitreTechnique } from "@/data/mitre";

export default function MitrePicker({
  caseId,
  selected,
  techniques,
}: {
  caseId: string;
  selected: string[];
  techniques: MitreTechnique[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string[]>(selected);
  const [pending, start] = useTransition();
  const router = useRouter();

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

  function save() {
    start(async () => {
      await updateMitreTechniques(caseId, current);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        className="kelpie-btn kelpie-btn-secondary"
        onClick={() => setOpen(true)}
      >
        Edit techniques
      </button>
    );
  }

  return (
    <div className="space-y-2">
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
          }}
          disabled={pending}
        >
          Cancel
        </button>
        <button
          className="kelpie-btn kelpie-btn-primary"
          onClick={save}
          disabled={pending}
        >
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
