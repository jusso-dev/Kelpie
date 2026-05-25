"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AccountSecurity({
  twoFactorEnabled,
  mfaRequired,
}: {
  twoFactorEnabled: boolean;
  mfaRequired: boolean;
}) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function enable() {
    setPending(true);
    setError(null);
    setMessage(null);
    const res = await fetch("/api/auth/two-factor/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password, issuer: "Kelpie" }),
    });
    setPending(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.message ?? "Could not start MFA setup");
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes ?? []);
    setMessage("Add this URI to your authenticator, then verify a code.");
  }

  async function verify() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Invalid authenticator code");
      return;
    }
    setMessage("MFA enabled.");
    router.refresh();
  }

  async function disable() {
    setPending(true);
    setError(null);
    const res = await fetch("/api/auth/two-factor/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Could not disable MFA. Check your password.");
      return;
    }
    setMessage("MFA disabled.");
    router.refresh();
  }

  return (
    <div className="kelpie-card p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Account security</h1>
        <p className="text-sm text-slate-400">
          MFA is {twoFactorEnabled ? "enabled" : "not enabled"}
          {mfaRequired ? " and required by your organisation." : "."}
        </p>
      </div>

      <div>
        <label
          htmlFor="security-password"
          className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
        >
          Current password
        </label>
        <input
          id="security-password"
          type="password"
          className="kelpie-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
      </div>

      {!twoFactorEnabled ? (
        <button
          type="button"
          className="kelpie-btn kelpie-btn-primary"
          onClick={enable}
          disabled={pending || !password}
        >
          Start MFA setup
        </button>
      ) : (
        <button
          type="button"
          className="kelpie-btn kelpie-btn-secondary"
          onClick={disable}
          disabled={pending || !password || mfaRequired}
        >
          Disable MFA
        </button>
      )}

      {totpUri ? (
        <div className="space-y-3 rounded border border-[color:var(--color-navy-700)] p-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-slate-400">
              Authenticator URI
            </div>
            <code className="mt-1 block break-all text-xs text-[color:var(--color-tan-300)]">
              {totpUri}
            </code>
          </div>
          <div>
            <label
              htmlFor="security-code"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Verification code
            </label>
            <input
              id="security-code"
              className="kelpie-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </div>
          <button
            type="button"
            className="kelpie-btn kelpie-btn-primary"
            onClick={verify}
            disabled={pending || !code}
          >
            Verify and enable
          </button>
          {backupCodes.length > 0 ? (
            <div>
              <div className="text-xs uppercase tracking-wider text-slate-400">
                Backup codes
              </div>
              <pre className="mt-1 overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
                {backupCodes.join("\n")}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {message ? <p className="text-sm text-green-400">{message}</p> : null}
      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
