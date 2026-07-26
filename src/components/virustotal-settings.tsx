"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import {
  removeVirusTotalSettings,
  saveVirusTotalSettings,
  testVirusTotalSettings,
} from "@/actions/enrichment-settings";
import {
  ConfirmActionButton,
  feedbackError,
} from "@/components/confirm-dialog";
import type { VirusTotalConfiguration } from "@/lib/enrichment/providers/virustotal";

export default function VirusTotalSettings({
  configuration,
  isAdmin,
}: {
  configuration: VirusTotalConfiguration;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [rateLimit, setRateLimit] = useState(
    String(configuration.rateLimitPerMinute),
  );
  const [pending, setPending] = useState<"save" | "test" | null>(null);

  function formData(): FormData {
    const data = new FormData();
    data.set("apiKey", apiKey);
    data.set("rateLimitPerMinute", rateLimit);
    return data;
  }

  async function save() {
    setPending("save");
    try {
      await saveVirusTotalSettings(formData());
      setApiKey("");
      toast.success("VirusTotal configuration saved", {
        description:
          "Supported observables will be enriched automatically when added to a case.",
      });
      router.refresh();
    } catch (error) {
      toast.error("VirusTotal configuration could not be saved", {
        description: feedbackError(
          error,
          "Nothing changed. Check the API key and rate limit.",
        ),
      });
    } finally {
      setPending(null);
    }
  }

  async function test() {
    setPending("test");
    try {
      const result = await testVirusTotalSettings(formData());
      toast.success("VirusTotal connection verified", {
        description: `Test report returned ${result.malicious} malicious and ${result.suspicious} suspicious detections.`,
      });
    } catch (error) {
      toast.error("VirusTotal connection failed", {
        description: feedbackError(
          error,
          "Check the API key and outbound network access.",
        ),
      });
    } finally {
      setPending(null);
    }
  }

  const sourceLabel =
    configuration.source === "organisation"
      ? "Managed in Kelpie"
      : configuration.source === "environment"
        ? "Container environment"
        : "Not configured";

  return (
    <div className="rounded-lg border border-[color:var(--color-navy-700)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 text-[color:var(--color-tan-400)]">
            <ScanSearch size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-slate-100">VirusTotal</h3>
              <span
                className={`kelpie-badge ${
                  configuration.configured
                    ? "text-green-400"
                    : "text-amber-400"
                }`}
              >
                {configuration.configured ? "connected" : "not configured"}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">
              Automatically checks IPs, domains, URLs, and file hashes added to
              cases. Results appear under each observable and are cached for 24
              hours.
            </p>
            <p className="mt-2 text-xs text-slate-400">
              Credential source: {sourceLabel}. Limit:{" "}
              {configuration.rateLimitPerMinute} requests per minute.
            </p>
          </div>
        </div>
        <KeyRound
          size={18}
          className="hidden shrink-0 text-slate-600 sm:block"
          aria-hidden="true"
        />
      </div>

      {isAdmin ? (
        <div className="border-t border-[color:var(--color-navy-700)] p-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(18rem,1fr)_12rem_auto] lg:items-end">
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
                API key
              </span>
              <input
                type="password"
                className="kelpie-input font-mono"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={
                  configuration.configured
                    ? "Leave blank to keep current key"
                    : "Paste VirusTotal API key"
                }
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs uppercase tracking-wider text-slate-400">
                Requests per minute
              </span>
              <input
                type="number"
                min={1}
                max={500}
                className="kelpie-input"
                value={rateLimit}
                onChange={(event) => setRateLimit(event.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <button
                type="button"
                className="kelpie-btn kelpie-btn-secondary"
                disabled={pending !== null}
                onClick={() => void test()}
              >
                {pending === "test" ? "Testing…" : "Test connection"}
              </button>
              <button
                type="button"
                className="kelpie-btn kelpie-btn-primary"
                disabled={pending !== null}
                onClick={() => void save()}
              >
                {pending === "save" ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
          {configuration.source === "organisation" ? (
            <div className="mt-4 flex justify-end border-t border-[color:var(--color-navy-700)] pt-4">
              <ConfirmActionButton
                action={async () => {
                  await removeVirusTotalSettings();
                  router.refresh();
                }}
                title="Remove VirusTotal credential?"
                description="Kelpie will stop requesting new VirusTotal enrichment unless a container environment key is configured. Existing case enrichment remains recorded."
                confirmLabel="Remove credential"
                triggerLabel="Remove credential"
                successTitle="VirusTotal credential removed"
                successDescription="New observables will no longer use the stored credential."
                errorTitle="VirusTotal credential could not be removed"
                className="kelpie-btn kelpie-btn-ghost text-red-400"
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="border-t border-[color:var(--color-navy-700)] px-4 py-3 text-xs text-slate-500">
          Only administrators can manage this credential.
        </p>
      )}
    </div>
  );
}
