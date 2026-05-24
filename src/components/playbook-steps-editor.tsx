"use client";

import { useState } from "react";

type DraftStep = {
  title: string;
  description: string;
  offsetMinutes: number;
  isRequired: boolean;
};

const STARTING: DraftStep[] = [
  {
    title: "Acknowledge and triage",
    description: "Open the case, confirm scope, set severity.",
    offsetMinutes: 15,
    isRequired: true,
  },
];

export default function PlaybookStepsEditor({
  initial,
}: {
  initial?: DraftStep[];
}) {
  const [steps, setSteps] = useState<DraftStep[]>(initial ?? STARTING);

  function update(i: number, patch: Partial<DraftStep>) {
    setSteps((prev) =>
      prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)),
    );
  }
  function remove(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i));
  }
  function add() {
    setSteps((prev) => [
      ...prev,
      { title: "", description: "", offsetMinutes: 60, isRequired: true },
    ]);
  }

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        Steps
      </label>
      <input type="hidden" name="steps" value={JSON.stringify(steps)} />
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div
            key={i}
            className="border border-[color:var(--color-navy-700)] rounded p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 font-mono w-6">{i + 1}</span>
              <input
                className="kelpie-input"
                placeholder="Step title"
                value={s.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost text-red-400"
                onClick={() => remove(i)}
              >
                Remove
              </button>
            </div>
            <textarea
              className="kelpie-input"
              rows={2}
              placeholder="Description (optional)"
              value={s.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <div className="flex gap-3 items-center">
              <label className="text-xs text-slate-400">Due (minutes after start)</label>
              <input
                type="number"
                min={0}
                className="kelpie-input max-w-[8rem]"
                value={s.offsetMinutes}
                onChange={(e) =>
                  update(i, { offsetMinutes: Number(e.target.value) || 0 })
                }
              />
              <label className="text-xs text-slate-400 inline-flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={s.isRequired}
                  onChange={(e) => update(i, { isRequired: e.target.checked })}
                />
                Required
              </label>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="kelpie-btn kelpie-btn-secondary mt-3"
        onClick={add}
      >
        Add step
      </button>
    </div>
  );
}
