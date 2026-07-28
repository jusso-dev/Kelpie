"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { refreshAttackCatalog, rollbackAttackCatalog } from "@/actions/attack";
import { ConfirmDialog, feedbackError } from "@/components/confirm-dialog";

export type CatalogVersionRow = {
  id: string;
  version: string;
  source: string;
  status: string;
  techniqueCount: number;
  tacticCount: number;
  error: string | null;
  importedAt: string;
  activatedAt: string | null;
};

export default function AttackCatalogAdminPanel({
  versions,
}: {
  versions: CatalogVersionRow[];
}) {
  const router = useRouter();
  const [sourceUrl, setSourceUrl] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<CatalogVersionRow | null>(null);
  const [rollbackPending, setRollbackPending] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      await refreshAttackCatalog(sourceUrl.trim() || undefined);
      toast.success("Catalog refresh queued", {
        description: "The BullMQ worker will import and activate the new snapshot; a failed import is rolled back automatically.",
      });
      router.refresh();
    } catch (error) {
      toast.error("Could not queue catalog refresh", {
        description: feedbackError(error, "Try again."),
      });
    } finally {
      setRefreshing(false);
    }
  }

  async function confirmRollback(reason?: string) {
    if (!rollbackTarget || !reason?.trim()) return;
    setRollbackPending(true);
    try {
      await rollbackAttackCatalog(rollbackTarget.id, reason.trim());
      setRollbackTarget(null);
      toast.success("Catalog version rolled back");
      router.refresh();
    } catch (error) {
      toast.error("Could not roll back catalog version", {
        description: feedbackError(error, "Try again."),
      });
    } finally {
      setRollbackPending(false);
    }
  }

  return (
    <div className="kelpie-card p-5 space-y-3">
      <div>
        <h2 className="text-sm font-medium text-slate-300">ATT&CK catalog</h2>
        <p className="text-xs text-slate-500 mt-1">
          Versioned and organisation-independent. Refresh from a configured URL, or leave
          blank to re-import the bundled offline baseline. A failed import is rolled back
          automatically and never touches the currently active catalog.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          className="kelpie-input flex-1"
          placeholder="https://example.com/attack-catalog.json (optional)"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
        />
        <button
          type="button"
          className="kelpie-btn kelpie-btn-secondary"
          disabled={refreshing}
          onClick={() => void refresh()}
        >
          {refreshing ? "Queuing..." : "Refresh catalog"}
        </button>
      </div>
      <ul className="space-y-1">
        {versions.map((v) => (
          <li
            key={v.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border border-[color:var(--color-navy-700)] p-2 text-xs"
          >
            <div>
              <span className="font-mono text-slate-300">{v.version}</span>
              <span className="ml-2 kelpie-badge">{v.status}</span>
              <span className="ml-2 text-slate-500">
                {v.techniqueCount} techniques, {v.tacticCount} tactics · {v.source}
              </span>
              {v.error ? <p className="text-red-400 mt-1">{v.error}</p> : null}
            </div>
            {v.status === "active" ? (
              <button
                type="button"
                className="kelpie-btn kelpie-btn-ghost kelpie-btn-sm"
                onClick={() => setRollbackTarget(v)}
              >
                Roll back
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={rollbackTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRollbackTarget(null);
        }}
        title={rollbackTarget ? `Roll back "${rollbackTarget.version}"?` : "Roll back?"}
        description="Restores the previous catalog version as active. This version stays visible in history as rolled back."
        confirmLabel="Roll back"
        pending={rollbackPending}
        tone="danger"
        reasonLabel="Reason"
        reasonPlaceholder="Why is this version being rolled back?"
        onConfirm={(reason) => void confirmRollback(reason)}
      />
    </div>
  );
}
