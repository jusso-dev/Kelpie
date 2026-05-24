"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createApiToken } from "@/actions/settings";

export default function TokenCreator() {
  const [issued, setIssued] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState("alerts:write");
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData();
    fd.set("name", name);
    fd.set("scopes", scopes);
    const res = await createApiToken(fd);
    setPending(false);
    setIssued(res.plaintext);
    setName("");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Name
          </label>
          <input
            className="kelpie-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="splunk-prod"
            required
          />
        </div>
        <div className="flex-1 min-w-[12rem]">
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Scopes (comma separated)
          </label>
          <input
            className="kelpie-input"
            value={scopes}
            onChange={(e) => setScopes(e.target.value)}
            placeholder="alerts:write,alerts:read"
          />
        </div>
        <button className="kelpie-btn kelpie-btn-primary" disabled={pending}>
          {pending ? "Creating..." : "Create token"}
        </button>
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
