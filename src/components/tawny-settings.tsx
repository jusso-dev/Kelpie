"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Radio } from "lucide-react";
import { toast } from "sonner";

/** Delivery health for the Tawny push producer, one row per organisation. */
export type TawnyInboundStatus = {
  lastDeliveryAt: Date | null;
  lastCaseCreatedAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
  lastErrorStatus: number | null;
  deliveryCount: number;
  createdCaseCount: number;
  duplicateCount: number;
  errorCount: number;
};

export type TawnySettingsProps = {
  /** Full copyable `POST` URL for the Tawny push endpoint. */
  endpoint: string;
  /** Delivery health, or `null` when no delivery has ever been recorded. */
  status: TawnyInboundStatus | null;
  /** Cases already imported from Tawny (`source_system = "tawny"`). */
  importedCaseCount: number;
  /** Tailors guidance text only; the card itself is visible to every role. */
  isAdmin: boolean;
};

const EXAMPLE_REQUEST = `POST <endpoint>
Content-Type: application/json
Authorization: Bearer klp_xxxxxxxx

{
  "title": "Tawny alert: anomalous OAuth grant",
  "severity": "high",
  "sourceSystem": "tawny",
  "sourceReference": "tawny-alert-8f21c0",
  "sourceUrl": "https://app.tawny.example/alerts/8f21c0"
}`;

function formatDateTime(value: Date | null): string {
  return value ? value.toLocaleString() : "never";
}

async function copyToClipboard(value: string, label: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Could not copy ${label.toLowerCase()}`, {
      description: "Copy it manually instead.",
    });
  }
}

export default function TawnySettings({
  endpoint,
  status,
  importedCaseCount,
  isAdmin,
}: TawnySettingsProps) {
  const [exampleCopied, setExampleCopied] = useState(false);
  const requestExample = EXAMPLE_REQUEST.replace("<endpoint>", endpoint);

  async function copyExample() {
    await copyToClipboard(requestExample, "Request example");
    setExampleCopied(true);
    window.setTimeout(() => setExampleCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-[color:var(--color-navy-700)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 text-[color:var(--color-tan-400)]">
            <Radio size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-slate-100">Tawny</h3>
              <span
                className={`kelpie-badge ${
                  status ? "text-green-400" : "text-slate-500"
                }`}
              >
                {status ? "receiving deliveries" : "no deliveries yet"}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Tawny pushes alerts directly to Kelpie as cases. Give Tawny a
              scoped API token and its own endpoint below; no polling is
              required.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-6 border-t border-[color:var(--color-navy-700)] p-4">
        {/* Copyable delivery endpoint */}
        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-slate-400">
            Delivery endpoint
          </h4>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded bg-[color:var(--color-navy-800)] px-3 py-2 text-xs text-slate-200">
              POST {endpoint}
            </code>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary text-xs"
              onClick={() => void copyToClipboard(endpoint, "Endpoint URL")}
            >
              <Copy size={14} aria-hidden="true" />
              Copy endpoint
            </button>
          </div>
        </div>

        {/* Least-privilege token guidance */}
        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-slate-400">
            API token
          </h4>
          <p className="max-w-2xl text-xs leading-5 text-slate-500">
            Tawny only needs an API token scoped to{" "}
            <code className="text-slate-300">cases:write</code> — nothing
            broader. The token value is shown once at creation and never
            again, so store it in Tawny&apos;s secret store immediately.{" "}
            {isAdmin ? (
              <>
                Create it under{" "}
                <Link href="/settings" className="kelpie-link">
                  Settings → API tokens
                </Link>
                .
              </>
            ) : (
              "Ask an administrator to create it under Settings → API tokens."
            )}
          </p>
        </div>

        {/* Delivery status */}
        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wider text-slate-400">
            Delivery status
          </h4>
          {status ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Last delivery" value={formatDateTime(status.lastDeliveryAt)} />
              <Stat label="Last case created" value={formatDateTime(status.lastCaseCreatedAt)} />
              <Stat label="Deliveries" value={String(status.deliveryCount)} />
              <Stat label="Cases created" value={String(status.createdCaseCount)} />
              <Stat label="Duplicate replays" value={String(status.duplicateCount)} />
              <Stat label="Errors" value={String(status.errorCount)} />
              <Stat label="Imported cases" value={String(importedCaseCount)} />
            </div>
          ) : (
            <p className="rounded border border-dashed border-slate-700 p-4 text-center text-xs text-slate-500">
              No deliveries received yet. Once Tawny sends its first alert,
              delivery status appears here.
            </p>
          )}
        </div>

        {/* Last error */}
        {status?.lastErrorAt ? (
          <div>
            <h4 className="mb-1 text-xs uppercase tracking-wider text-slate-400">
              Last error
            </h4>
            <div className="rounded border border-red-900/60 bg-red-950/20 p-3 text-xs">
              <p className="text-slate-400">
                {formatDateTime(status.lastErrorAt)}
                {status.lastErrorStatus !== null
                  ? ` · HTTP ${status.lastErrorStatus}`
                  : ""}
              </p>
              {status.lastErrorMessage ? (
                <p className="mt-1 break-words text-red-300">
                  {status.lastErrorMessage}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Link to imported cases */}
        <div>
          <Link href="/cases?source=tawny" className="kelpie-link text-xs">
            View Tawny cases
          </Link>
        </div>

        {/* Copyable request example */}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h4 className="text-xs uppercase tracking-wider text-slate-400">
              Request example
            </h4>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost text-xs"
              onClick={() => void copyExample()}
            >
              <Copy size={14} aria-hidden="true" />
              {exampleCopied ? "Copied" : "Copy example"}
            </button>
          </div>
          <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
            {requestExample}
          </pre>
          <p className="mt-2 text-xs text-slate-500">
            Kelpie de-duplicates on{" "}
            <code className="text-slate-300">sourceReference</code>: the
            first delivery for a given reference returns{" "}
            <code className="text-slate-300">201</code> with{" "}
            <code className="text-slate-300">created: true</code>; replaying
            the same reference returns <code className="text-slate-300">200</code>{" "}
            with <code className="text-slate-300">created: false</code> and
            no duplicate case.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[color:var(--color-navy-700)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-slate-200">{value}</p>
    </div>
  );
}
