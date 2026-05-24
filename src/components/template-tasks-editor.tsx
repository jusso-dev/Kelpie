"use client";

import { useState } from "react";

type DraftTask = { title: string; description: string };

export default function TemplateTasksEditor() {
  const [tasks, setTasks] = useState<DraftTask[]>([]);

  function add() {
    setTasks((prev) => [...prev, { title: "", description: "" }]);
  }
  function update(i: number, patch: Partial<DraftTask>) {
    setTasks((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function remove(i: number) {
    setTasks((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        Default tasks
      </label>
      <input type="hidden" name="defaultTasks" value={JSON.stringify(tasks)} />
      <div className="space-y-2">
        {tasks.map((t, i) => (
          <div
            key={i}
            className="border border-[color:var(--color-navy-700)] rounded p-2 space-y-1"
          >
            <div className="flex gap-2">
              <input
                className="kelpie-input"
                value={t.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Task title"
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
              value={t.description}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder="Description (optional)"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        className="kelpie-btn kelpie-btn-secondary mt-2"
        onClick={add}
      >
        Add task
      </button>
    </div>
  );
}
