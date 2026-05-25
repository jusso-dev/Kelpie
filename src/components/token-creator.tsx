"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createApiToken } from "@/actions/settings";
import { KNOWN_SCOPES } from "@/lib/scopes";

const EXPIRY_OPTIONS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "1 year" },
  { value: "never", label: "Never" },
];

export default function TokenCreator() {
  const [issued, setIssued] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["alerts:write"]);
  const [expiresAt, setExpiresAt] = useState("90");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  function toggleScope(s: string) {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("scopes", JSON.stringify(scopes));
    fd.set("expiresAt", expiresAt);
    const res = await createApiToken(fd);
    setPending(false);
    setIssued(res.plaintext);
    setName("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="space-y-3 border border-[color:var(--color-navy-700)] rounded p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[12rem]">
            <label
              htmlFor="token-name"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Name
            </label>
            <input
              id="token-name"
              className="kelpie-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="splunk-prod"
              required
            />
          </div>
          <div className="min-w-[10rem]">
            <label
              htmlFor="token-expiry"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Expiry
            </label>
            <select
              id="token-expiry"
              className="kelpie-input"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">
            Scopes
          </div>
          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            {KNOWN_SCOPES.map((s) => (
              <label key={s.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="kelpie-checkbox"
                  checked={scopes.includes(s.value)}
                  onChange={() => toggleScope(s.value)}
                />
                <span className="font-mono text-slate-300">{s.value}</span>
                <span className="text-slate-500">{s.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <button className="kelpie-btn kelpie-btn-primary" disabled={pending || scopes.length === 0}>
            {pending ? "Creating..." : "Create token"}
          </button>
        </div>
      </form>
      {issued ? (
        <div className="rounded border border-[color:var(--color-tan-500)] bg-[color:var(--color-navy-800)] p-3 text-sm">
          <p className="text-slate-200 mb-1">
            New token. Copy it now — it will not be shown again.
          </p>
          <code className="font-mono text-[color:var(--color-tan-300)] break-all">
            {issued}
          </code>
        </div>
      ) : null}
    </div>
  );
}
