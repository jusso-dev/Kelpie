"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { importContextCsvAction } from "@/actions/asset-context";

const CSV_HEADER =
  "kind,display_name,identifier_kind,identifier_value,criticality,privilege_level,exposure,environment,is_crown_jewel,recovery_priority,owner_team,owner_email,business_service,application_name,data_classifications,regulatory_scope,external_id";

export default function AssetContextImport() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [csvText, setCsvText] = useState(`${CSV_HEADER}\n`);
  const [lastResult, setLastResult] = useState<{
    dryRun: boolean;
    successCount: number;
    errorCount: number;
    errors: Array<{ row: number; field?: string; message: string }>;
  } | null>(null);

  function run(dryRun: boolean) {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("csvText", csvText);
      fd.set("dryRun", dryRun ? "true" : "false");
      const res = await importContextCsvAction(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setLastResult({
        dryRun: res.run.dryRun,
        successCount: res.run.successCount,
        errorCount: res.run.errorCount,
        errors: (res.errors ?? []) as Array<{
          row: number;
          field?: string;
          message: string;
        }>,
      });
      toast.success(
        dryRun
          ? `Dry-run: ${res.validRowCount} valid rows, ${res.errors.length} errors`
          : `Imported: ${res.run.createdCount} created, ${res.run.updatedCount} updated`,
      );
      if (!dryRun) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        CSV columns: {CSV_HEADER}. Validate with dry-run before applying.
        Provider rows never overwrite analyst overrides.
      </p>
      <textarea
        className="kelpie-input font-mono text-xs min-h-[12rem] w-full"
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
        spellCheck={false}
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="kelpie-btn kelpie-btn-secondary"
          disabled={pending}
          onClick={() => run(true)}
        >
          Validate (dry-run)
        </button>
        <button
          type="button"
          className="kelpie-btn kelpie-btn-primary"
          disabled={pending}
          onClick={() => run(false)}
        >
          Import
        </button>
      </div>
      {lastResult ? (
        <div className="text-sm text-slate-300 space-y-1">
          <p>
            {lastResult.dryRun ? "Dry-run" : "Import"} — success{" "}
            {lastResult.successCount}, errors {lastResult.errorCount}
          </p>
          {lastResult.errors.length > 0 ? (
            <ul className="text-xs text-red-300 max-h-40 overflow-y-auto space-y-0.5">
              {lastResult.errors.slice(0, 50).map((e, i) => (
                <li key={`${e.row}-${i}`}>
                  Row {e.row}
                  {e.field ? ` (${e.field})` : ""}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
