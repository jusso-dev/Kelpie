"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { revokeApiToken, rotateApiToken } from "@/actions/settings";

type Token = {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  deprecatedAt: string | null;
};

export default function TokenList({
  tokens,
  isAdmin,
}: {
  tokens: Token[];
  isAdmin: boolean;
}) {
  const [rotated, setRotated] = useState<string | null>(null);
  const router = useRouter();

  async function onRevoke(id: string, name: string) {
    if (!confirm(`Revoke token "${name}"? This cannot be undone.`)) return;
    await revokeApiToken(id);
    router.refresh();
  }
  async function onRotate(id: string) {
    if (!confirm("Rotate token? A new token is issued; the old one is deprecated.")) return;
    const res = await rotateApiToken(id);
    setRotated(res.plaintext);
    router.refresh();
  }

  return (
    <div className="mt-4">
      {rotated ? (
        <div className="rounded border border-[color:var(--color-tan-500)] bg-[color:var(--color-navy-800)] p-3 text-sm mb-3">
          <p className="text-slate-200 mb-1">
            Rotated token. Copy it now — it will not be shown again.
          </p>
          <code className="font-mono text-[color:var(--color-tan-300)] break-all">
            {rotated}
          </code>
        </div>
      ) : null}
      <table className="kelpie-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Scopes</th>
            <th>Expires</th>
            <th>Created</th>
            <th>Last used</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {tokens.length === 0 ? (
            <tr>
              <td colSpan={6} className="text-center text-slate-500 py-6">
                No tokens.
              </td>
            </tr>
          ) : (
            tokens.map((t) => {
              const expired =
                t.expiresAt && new Date(t.expiresAt).getTime() < Date.now();
              return (
                <tr key={t.id} className={t.deprecatedAt ? "opacity-50" : ""}>
                  <td>
                    {t.name}
                    {t.deprecatedAt ? (
                      <span className="ml-2 text-[10px] uppercase text-slate-500">
                        deprecated
                      </span>
                    ) : null}
                  </td>
                  <td className="text-xs text-slate-400 font-mono">
                    {t.scopes.length === 0 ? (
                      <span className="text-amber-400">any</span>
                    ) : (
                      t.scopes.join(", ")
                    )}
                  </td>
                  <td className="text-xs">
                    {t.expiresAt ? (
                      <span className={expired ? "text-red-400" : "text-slate-400"}>
                        {format(new Date(t.expiresAt), "PP")}
                      </span>
                    ) : (
                      <span className="text-slate-500">Never</span>
                    )}
                  </td>
                  <td className="text-xs text-slate-500">
                    {format(new Date(t.createdAt), "PP")}
                  </td>
                  <td className="text-xs text-slate-500">
                    {t.lastUsedAt ? (
                      <>
                        {format(new Date(t.lastUsedAt), "PP p")}
                        {t.lastUsedIp ? (
                          <div className="text-[10px] text-slate-600 font-mono">
                            {t.lastUsedIp}
                          </div>
                        ) : null}
                      </>
                    ) : (
                      "Never"
                    )}
                  </td>
                  <td className="text-right">
                    {isAdmin ? (
                      <div className="flex justify-end gap-1">
                        {!t.deprecatedAt ? (
                          <button
                            className="kelpie-btn kelpie-btn-ghost text-xs"
                            onClick={() => onRotate(t.id)}
                          >
                            Rotate
                          </button>
                        ) : null}
                        <button
                          className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs"
                          onClick={() => onRevoke(t.id, t.name)}
                        >
                          Revoke
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
