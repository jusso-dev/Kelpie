"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Network } from "lucide-react";
import { toast } from "sonner";
import {
  removeBrolgaSettings,
  saveBrolgaSettings,
  testBrolgaSettings,
} from "@/actions/enrichment-settings";
import {
  ConfirmActionButton,
  feedbackError,
} from "@/components/confirm-dialog";
import type { BrolgaConfiguration } from "@/lib/brolga/config";

export default function BrolgaSettings({
  configuration,
  isAdmin,
}: {
  configuration: BrolgaConfiguration;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [baseUrl, setBaseUrl] = useState(configuration.baseUrl ?? "");
  const [apiToken, setApiToken] = useState("");
  const [enabled, setEnabled] = useState(configuration.enabled);
  const [timeoutMs, setTimeoutMs] = useState(String(configuration.timeoutMs));
  const [pending, setPending] = useState<"save" | "test" | null>(null);

  function formData(): FormData {
    const data = new FormData();
    data.set("baseUrl", baseUrl);
    data.set("apiKey", apiToken);
    data.set("enabled", enabled ? "true" : "false");
    data.set("timeoutMs", timeoutMs);
    return data;
  }

  async function save() {
    setPending("save");
    try {
      await saveBrolgaSettings(formData());
      setApiToken("");
      toast.success("Brolga settings saved", {
        description: enabled
          ? "Kelpie will request context packs when the Brolga API is available."
          : "Integration saved but left disabled.",
      });
      router.refresh();
    } catch (error) {
      toast.error("Brolga settings could not be saved", {
        description: feedbackError(error, "Check the base URL and options."),
      });
    } finally {
      setPending(null);
    }
  }

  async function test() {
    setPending("test");
    try {
      const result = await testBrolgaSettings();
      if (result.ok) {
        toast.success("Brolga connection verified", {
          description: result.message,
        });
      } else {
        toast.message("Brolga not ready", {
          description: result.message,
        });
      }
    } catch (error) {
      toast.error("Brolga connection failed", {
        description: feedbackError(error, "Check URL, token, and network policy."),
      });
    } finally {
      setPending(null);
    }
  }

  const sourceLabel =
    configuration.urlSource === "organisation"
      ? "Managed in Kelpie"
      : configuration.urlSource === "environment"
        ? "Container environment"
        : "Not configured";

  return (
    <div className="mt-3 rounded-lg border border-[color:var(--color-navy-700)]">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 text-[color:var(--color-tan-400)]">
            <Network size={20} aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-medium text-slate-100">Brolga</h3>
              <span
                className={`kelpie-badge ${
                  configuration.enabled && configuration.configured
                    ? "text-green-400"
                    : configuration.configured
                      ? "text-amber-400"
                      : "text-slate-500"
                }`}
              >
                {configuration.enabled && configuration.configured
                  ? "Enabled"
                  : configuration.configured
                    ? "Configured · disabled"
                    : "Not configured"}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
              Optional threat-intelligence context engine. Kelpie will request
              compact context packs for observables; MISP, TAXII, and bulk feeds
              stay in Brolga. API expected from Brolga v0.5.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              URL source: {sourceLabel}
              {configuration.hasToken
                ? ` · token from ${configuration.tokenSource ?? "unknown"}`
                : " · no token"}
            </p>
          </div>
        </div>
      </div>

      {isAdmin ? (
        <div className="space-y-3 border-t border-[color:var(--color-navy-700)] p-4">
          <div>
            <label
              htmlFor="brolga-base-url"
              className="block text-xs uppercase tracking-wider text-slate-500"
            >
              Base URL
            </label>
            <input
              id="brolga-base-url"
              className="kelpie-input mt-1 font-mono text-sm"
              placeholder="https://brolga.homelab"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div>
            <label
              htmlFor="brolga-token"
              className="block text-xs uppercase tracking-wider text-slate-500"
            >
              API token (optional until Brolga auth ships)
            </label>
            <input
              id="brolga-token"
              type="password"
              className="kelpie-input mt-1 font-mono text-sm"
              placeholder={
                configuration.hasToken
                  ? "••••••••  (leave blank to keep)"
                  : "Bearer token"
              }
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="brolga-timeout"
                className="block text-xs uppercase tracking-wider text-slate-500"
              >
                Timeout (ms)
              </label>
              <input
                id="brolga-timeout"
                type="number"
                min={1000}
                max={30000}
                className="kelpie-input mt-1"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
              />
            </div>
            <label className="mt-6 flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                className="kelpie-checkbox"
                checked={enabled}
                onChange={(event) => setEnabled(event.target.checked)}
              />
              Enable Brolga enrichment
            </label>
          </div>
          <p className="text-xs text-slate-500">
            Homelab private URLs need{" "}
            <code className="text-slate-400">KELPIE_ALLOW_PRIVATE_NETWORKS=true</code>{" "}
            on the Kelpie app container.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="kelpie-btn kelpie-btn-primary"
              disabled={pending !== null}
              onClick={() => void save()}
            >
              {pending === "save" ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="kelpie-btn kelpie-btn-secondary"
              disabled={pending !== null}
              onClick={() => void test()}
            >
              {pending === "test" ? "Testing…" : "Test connection"}
            </button>
            {configuration.configured ? (
              <ConfirmActionButton
                action={async () => {
                  await removeBrolgaSettings();
                  setBaseUrl("");
                  setEnabled(false);
                  router.refresh();
                }}
                title="Remove Brolga settings?"
                description="Kelpie will stop requesting context packs until Brolga is configured again."
                confirmLabel="Remove"
                triggerLabel="Remove"
                successTitle="Brolga settings removed"
                successDescription="Enrichment will not call Brolga until it is configured again."
                className="kelpie-btn kelpie-btn-ghost text-red-400"
              />
            ) : null}
          </div>
        </div>
      ) : (
        <p className="border-t border-[color:var(--color-navy-700)] p-4 text-xs text-slate-500">
          Only administrators can configure Brolga.
        </p>
      )}
    </div>
  );
}
