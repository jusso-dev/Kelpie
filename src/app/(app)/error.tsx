"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Workspace route failed", error.digest ?? "unidentified error");
  }, [error.digest]);

  function retry() {
    reset();
    window.location.reload();
  }

  return (
    <section className="mx-auto max-w-2xl py-10 sm:py-16" aria-labelledby="workspace-error-title">
      <div className="kelpie-card px-5 py-10 text-center sm:px-10">
        <AlertTriangle className="mx-auto text-amber-300" size={30} aria-hidden="true" />
        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-amber-300">
          Workspace interrupted
        </p>
        <h1 id="workspace-error-title" className="mt-2 text-2xl font-semibold text-slate-50">
          This view could not be loaded
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-400">
          Your saved data is unchanged. Retry the view, or return to a safe queue and continue working.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" className="kelpie-btn kelpie-btn-primary" onClick={retry}>
            <RotateCcw size={16} aria-hidden="true" />
            Retry this view
          </button>
          <Link href="/cases" className="kelpie-btn kelpie-btn-secondary">
            Go to case queue
          </Link>
          <Link href="/dashboard" className="kelpie-btn kelpie-btn-ghost">
            Go to overview
          </Link>
        </div>
      </div>
    </section>
  );
}
