"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  pauseIntegrationConnection,
  resumeIntegrationConnection,
  testIntegrationConnection,
  exportIntegrationDiagnostics,
} from "@/actions/integrations";
import type { IntegrationHealth } from "@/lib/integrations/types";

export type IntegrationHealthPanelProps = {
  connections: IntegrationHealth[];
  isAdmin: boolean;
};

function statusClass(status: string): string {
  switch (status) {
    case "healthy":
      return "text-green-400";
    case "degraded":
    case "rate_limited":
    case "conflicting":
      return "text-amber-400";
    case "unhealthy":
    case "expired":
      return "text-red-400";
    case "paused":
      return "text-slate-400";
    default:
      return "text-slate-500";
  }
}

export default function IntegrationHealthPanel({
  connections,
  isAdmin,
}: IntegrationHealthPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [exporting, setExporting] = useState(false);

  function run(action: () => Promise<unknown>, okMsg: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(okMsg);
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Action failed");
      }
    });
  }

  async function onExport() {
    setExporting(true);
    try {
      const bundle = await exportIntegrationDiagnostics();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kelpie-integration-diagnostics-${bundle.exportedAt.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Diagnostics exported (secret-free)");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  if (connections.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        No integration health recorded yet. Configure a case source, TI feed,
        webhook, or inbound producer to begin tracking.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Typed health without credentials or sensitive provider payloads.
        </p>
        {isAdmin ? (
          <button
            type="button"
            className="kelpie-btn kelpie-btn-ghost text-xs"
            disabled={exporting}
            onClick={() => void onExport()}
          >
            {exporting ? "Exporting…" : "Export diagnostics"}
          </button>
        ) : null}
      </div>
      <ul className="divide-y divide-[color:var(--color-navy-700)] rounded-lg border border-[color:var(--color-navy-700)]">
        {connections.map((conn) => (
          <li
            key={`${conn.connectionKind}:${conn.connectionId}`}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-200">
                  {conn.displayName || conn.connectionId}
                </p>
                <span className={`text-xs font-medium ${statusClass(conn.status)}`}>
                  {conn.status}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-slate-500">
                  {conn.connectionKind}
                </span>
                {conn.stale ? (
                  <span className="text-xs text-amber-400">stale</span>
                ) : null}
              </div>
              <p className="text-xs text-slate-500">
                Last success{" "}
                {conn.lastSuccessAt
                  ? new Date(conn.lastSuccessAt).toLocaleString()
                  : "never"}
                {conn.errorCategory ? ` · ${conn.errorCategory}` : ""}
                {conn.openConflictCount > 0
                  ? ` · ${conn.openConflictCount} conflict(s)`
                  : ""}
              </p>
              {conn.errorSummary ? (
                <p className="text-xs text-red-300/90">{conn.errorSummary}</p>
              ) : null}
              {conn.credentials.length > 0 ? (
                <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
                  {conn.credentials.map((cred) => (
                    <li key={cred.id}>
                      {cred.label}
                      {cred.fingerprint ? ` · fp …${cred.fingerprint}` : ""}
                      {cred.rotationState !== "active"
                        ? ` · ${cred.rotationState}`
                        : ""}
                      {cred.expiresAt
                        ? ` · expires ${new Date(cred.expiresAt).toLocaleDateString()}`
                        : ""}
                      {cred.consentedScopes.length > 0
                        ? ` · scopes ${cred.consentedScopes.join(", ")}`
                        : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              {conn.warnings.length > 0 ? (
                <ul className="mt-1 space-y-0.5">
                  {conn.warnings.map((w) => (
                    <li
                      key={`${w.code}-${w.message}`}
                      className={
                        w.severity === "critical"
                          ? "text-xs text-red-300"
                          : w.severity === "warning"
                            ? "text-xs text-amber-300"
                            : "text-xs text-slate-500"
                      }
                    >
                      {w.message}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[11px] text-slate-600">
                outbound {conn.writeEnabled && conn.outboundEnabled ? "on" : "off"} ·
                read {conn.readPermissionOk == null ? "?" : conn.readPermissionOk ? "ok" : "fail"} ·
                cursor {conn.lastSourceCursor ? "set" : "none"}
              </p>
            </div>
            {isAdmin ? (
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-ghost text-xs"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        testIntegrationConnection(
                          conn.connectionKind,
                          conn.connectionId,
                        ),
                      "Connection test recorded",
                    )
                  }
                >
                  Test
                </button>
                {conn.isPaused ? (
                  <button
                    type="button"
                    className="kelpie-btn kelpie-btn-ghost text-xs"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          resumeIntegrationConnection(
                            conn.connectionKind,
                            conn.connectionId,
                          ),
                        "Connection resumed",
                      )
                    }
                  >
                    Resume
                  </button>
                ) : (
                  <button
                    type="button"
                    className="kelpie-btn kelpie-btn-ghost text-xs"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () =>
                          pauseIntegrationConnection(
                            conn.connectionKind,
                            conn.connectionId,
                          ),
                        "Connection paused",
                      )
                    }
                  >
                    Pause
                  </button>
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
