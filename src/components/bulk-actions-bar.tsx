"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { runBulkOperation } from "@/actions/bulk-operations";
import { feedbackError } from "@/components/confirm-dialog";
import type { BulkOperationType } from "@/lib/bulk-operations-core";

type Option = { id: string; name: string };

const OPERATIONS: Array<{ value: BulkOperationType; label: string }> = [
  { value: "assign_queue", label: "Assign to queue" },
  { value: "assign_analyst", label: "Assign analyst" },
  { value: "add_watcher", label: "Add watcher" },
  { value: "remove_watcher", label: "Remove watcher" },
  { value: "add_tag", label: "Add tag" },
  { value: "remove_tag", label: "Remove tag" },
  { value: "set_severity", label: "Set severity" },
  { value: "set_status", label: "Set status" },
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

/**
 * The checkboxes it acts on live inside the cases table elsewhere in the DOM
 * and are associated purely through the HTML `form` attribute (each checkbox
 * sets `form={formId}`), so this bar can sit anywhere on the page without a
 * client-side selection store.
 */
export function BulkActionsBar({
  formId,
  queues,
  members,
}: {
  formId: string;
  queues: Array<Option & { teamName: string }>;
  members: Option[];
}) {
  const [operation, setOperation] = useState<BulkOperationType>("assign_queue");
  const [pending, start] = useTransition();
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const caseIds = data.getAll("caseIds").map(String);
    if (caseIds.length === 0) {
      toast.warning("Select at least one case first");
      return;
    }
    const params: Record<string, unknown> = {};
    if (operation === "assign_queue") params.queueId = data.get("queueId") || null;
    if (operation === "assign_analyst") params.assigneeId = data.get("assigneeId") || null;
    if (operation === "add_watcher" || operation === "remove_watcher") {
      params.userId = String(data.get("userId") ?? "");
    }
    if (operation === "add_tag" || operation === "remove_tag") {
      params.tag = String(data.get("tag") ?? "");
    }
    if (operation === "set_severity") params.severity = data.get("severity");
    if (operation === "set_status") params.status = data.get("status");

    start(async () => {
      const result = await runBulkOperation(operation, caseIds, params);
      if (!result.ok) {
        toast.error("Bulk operation failed", { description: feedbackError(result.error, "") });
        return;
      }
      if (result.failureCount === 0) {
        toast.success(`Updated ${result.successCount} case${result.successCount === 1 ? "" : "s"}`);
      } else {
        toast.warning(
          `Updated ${result.successCount} of ${result.attempted} cases`,
          { description: `${result.failureCount} case${result.failureCount === 1 ? "" : "s"} could not be changed.` },
        );
      }
      router.refresh();
    });
  }

  return (
    <form
      id={formId}
      onSubmit={handleSubmit}
      className="kelpie-panel flex flex-wrap items-end gap-3 p-4"
      aria-label="Bulk case actions"
    >
      <label className="text-xs font-medium text-slate-300">
        Bulk action
        <select
          className="kelpie-input mt-1"
          value={operation}
          onChange={(event) => setOperation(event.target.value as BulkOperationType)}
        >
          {OPERATIONS.map((op) => (
            <option key={op.value} value={op.value}>{op.label}</option>
          ))}
        </select>
      </label>

      {operation === "assign_queue" ? (
        <label className="text-xs font-medium text-slate-300">
          Queue
          <select name="queueId" className="kelpie-input mt-1">
            <option value="">No queue</option>
            {queues.map((queue) => (
              <option key={queue.id} value={queue.id}>{queue.teamName} / {queue.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      {operation === "assign_analyst" ? (
        <label className="text-xs font-medium text-slate-300">
          Analyst
          <select name="assigneeId" className="kelpie-input mt-1">
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      {operation === "add_watcher" || operation === "remove_watcher" ? (
        <label className="text-xs font-medium text-slate-300">
          Watcher
          <select name="userId" className="kelpie-input mt-1" required>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
        </label>
      ) : null}

      {operation === "add_tag" || operation === "remove_tag" ? (
        <label className="text-xs font-medium text-slate-300">
          Tag
          <input name="tag" className="kelpie-input mt-1" required placeholder="ransomware" />
        </label>
      ) : null}

      {operation === "set_severity" ? (
        <label className="text-xs font-medium text-slate-300">
          Severity
          <select name="severity" className="kelpie-input mt-1">
            {SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      ) : null}

      {operation === "set_status" ? (
        <label className="text-xs font-medium text-slate-300">
          Status
          <select name="status" className="kelpie-input mt-1">
            {STATUSES.map((value) => (
              <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
            ))}
          </select>
        </label>
      ) : null}

      <button type="submit" className="kelpie-btn kelpie-btn-primary" disabled={pending}>
        Apply to selected
      </button>
      <p className="text-xs text-slate-500">
        Select cases with the checkboxes in the first column, then apply.
      </p>
    </form>
  );
}
