"use client";

import { createContext, useContext, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { applyBulkOperation } from "@/actions/bulk-operations";
import type { BulkOperationType } from "@/lib/bulk-ops-core";
import { feedbackError } from "@/components/confirm-dialog";

type SelectionContextValue = {
  selected: Set<string>;
  toggle: (caseId: string) => void;
  clear: () => void;
  setMany: (caseIds: string[], value: boolean) => void;
};

const SelectionContext = createContext<SelectionContextValue | null>(null);

export function CaseSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const value = useMemo<SelectionContextValue>(
    () => ({
      selected,
      toggle: (caseId) =>
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(caseId)) next.delete(caseId);
          else next.add(caseId);
          return next;
        }),
      clear: () => setSelected(new Set()),
      setMany: (caseIds, add) =>
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of caseIds) {
            if (add) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
    }),
    [selected],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used within a CaseSelectionProvider");
  return ctx;
}

export function CaseRowCheckbox({ caseId, label }: { caseId: string; label: string }) {
  const { selected, toggle } = useSelection();
  return (
    <input
      type="checkbox"
      aria-label={`Select case ${label}`}
      checked={selected.has(caseId)}
      onChange={() => toggle(caseId)}
    />
  );
}

export function SelectAllCheckbox({ caseIds }: { caseIds: string[] }) {
  const { selected, setMany } = useSelection();
  const allSelected = caseIds.length > 0 && caseIds.every((id) => selected.has(id));
  return (
    <input
      type="checkbox"
      aria-label="Select all cases on this page"
      checked={allSelected}
      onChange={() => setMany(caseIds, !allSelected)}
    />
  );
}

const OPERATIONS: Array<{ value: BulkOperationType; label: string }> = [
  { value: "queue_assign", label: "Assign to queue" },
  { value: "analyst_assign", label: "Assign analyst" },
  { value: "watcher_add", label: "Add watcher" },
  { value: "watcher_remove", label: "Remove watcher" },
  { value: "tag_add", label: "Add tag" },
  { value: "tag_remove", label: "Remove tag" },
  { value: "severity_change", label: "Change severity" },
  { value: "status_change", label: "Change status" },
  { value: "acknowledge", label: "Acknowledge" },
];

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = [
  "open",
  "in_progress",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;

export function BulkActionBar({
  teams,
  users,
}: {
  teams: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}) {
  const { selected, clear } = useSelection();
  const [operationType, setOperationType] = useState<BulkOperationType>("analyst_assign");
  const [value, setValue] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (selected.size === 0) return null;
  const caseIds = Array.from(selected);

  function buildPayload() {
    switch (operationType) {
      case "queue_assign":
        return { queueId: value || null };
      case "analyst_assign":
        return { assigneeId: value || null };
      case "watcher_add":
      case "watcher_remove":
        return { userId: value };
      case "tag_add":
      case "tag_remove":
        return { tag: value };
      case "severity_change":
        return { severity: value };
      case "status_change":
        return { status: value };
      case "acknowledge":
        return {};
    }
  }

  function apply() {
    const payload = buildPayload();
    start(async () => {
      try {
        const result = await applyBulkOperation({
          operationType,
          caseIds,
          idempotencyKey: crypto.randomUUID(),
          payload,
        });
        if (result.failureCount > 0) {
          toast.warning(
            `${result.successCount} of ${result.requestedCount} cases updated`,
            { description: "Some cases could not be updated — check they still exist in your organisation." },
          );
        } else {
          toast.success(`${result.successCount} case${result.successCount === 1 ? "" : "s"} updated`);
        }
        clear();
        router.refresh();
      } catch (error) {
        toast.error("Bulk operation failed", {
          description: feedbackError(error, "Try again."),
        });
      }
    });
  }

  return (
    <div
      role="region"
      aria-label="Bulk case actions"
      className="kelpie-panel sticky bottom-4 z-10 flex flex-wrap items-end gap-3 p-4 shadow-lg"
    >
      <p className="text-sm text-slate-200">
        {caseIds.length} case{caseIds.length === 1 ? "" : "s"} selected
      </p>
      <label className="text-xs font-medium text-slate-300">
        Action
        <select
          className="kelpie-input mt-1"
          value={operationType}
          disabled={pending}
          onChange={(e) => {
            setOperationType(e.target.value as BulkOperationType);
            setValue("");
          }}
        >
          {OPERATIONS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      </label>

      {operationType === "queue_assign" ? (
        <label className="text-xs font-medium text-slate-300">
          Queue
          <select className="kelpie-input mt-1" value={value} disabled={pending} onChange={(e) => setValue(e.target.value)}>
            <option value="">No queue</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      ) : null}

      {operationType === "analyst_assign" || operationType === "watcher_add" || operationType === "watcher_remove" ? (
        <label className="text-xs font-medium text-slate-300">
          {operationType === "analyst_assign" ? "Analyst" : "Person"}
          <select className="kelpie-input mt-1" value={value} disabled={pending} onChange={(e) => setValue(e.target.value)}>
            <option value="">{operationType === "analyst_assign" ? "Unassigned" : "Select…"}</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      ) : null}

      {operationType === "tag_add" || operationType === "tag_remove" ? (
        <label className="text-xs font-medium text-slate-300">
          Tag
          <input className="kelpie-input mt-1" value={value} disabled={pending} onChange={(e) => setValue(e.target.value)} />
        </label>
      ) : null}

      {operationType === "severity_change" ? (
        <label className="text-xs font-medium text-slate-300">
          Severity
          <select className="kelpie-input mt-1" value={value} disabled={pending} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
      ) : null}

      {operationType === "status_change" ? (
        <label className="text-xs font-medium text-slate-300">
          Status
          <select className="kelpie-input mt-1" value={value} disabled={pending} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      ) : null}

      <button
        type="button"
        className="kelpie-btn kelpie-btn-primary"
        disabled={
          pending ||
          (operationType !== "acknowledge" &&
            operationType !== "analyst_assign" &&
            operationType !== "queue_assign" &&
            !value)
        }
        onClick={apply}
      >
        Apply to {caseIds.length}
      </button>
      <button type="button" className="kelpie-btn kelpie-btn-ghost" disabled={pending} onClick={clear}>
        Clear selection
      </button>
    </div>
  );
}
