"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmActionButton } from "@/components/confirm-dialog";
import { authClient } from "@/lib/auth-client";

type Passkey = {
  id: string;
  name?: string | null;
  deviceType?: string;
};

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
  const [passkeyName, setPasskeyName] = useState("");
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [passkeysLoading, setPasskeysLoading] = useState(true);

  async function loadPasskeys() {
    const res = await authClient.passkey.listUserPasskeys();
    if (res.error) {
      const message = res.error.message ?? "Could not load passkeys";
      setError(message);
      toast.error("Passkeys could not be loaded", {
        description: `${message}. Your existing sign-in methods are unaffected.`,
      });
      return;
    }
    setPasskeys(res.data ?? []);
  }

  useEffect(() => {
    loadPasskeys()
      .catch(() => setError("Could not load passkeys"))
      .finally(() => setPasskeysLoading(false));
  }, []);

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
      const errorMessage = data?.message ?? "Could not start MFA setup";
      setError(errorMessage);
      toast.error("MFA setup could not start", {
        description: `${errorMessage}. Check your current password and try again.`,
      });
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes ?? []);
    setMessage("Add this URI to your authenticator, then verify a code.");
    toast.success("MFA setup started", {
      description: "Add Kelpie to your authenticator, then enter a code to finish.",
    });
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
      toast.error("Code was not accepted", {
        description: "MFA is not enabled yet. Enter the newest code from your authenticator.",
      });
      return;
    }
    setMessage("MFA enabled.");
    toast.success("MFA enabled", {
      description: "Your authenticator is now required when you sign in.",
    });
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
      throw new Error("Your password was not accepted. MFA remains enabled.");
    }
    setMessage("MFA disabled.");
    router.refresh();
  }

  async function addPasskey() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authClient.passkey.addPasskey({
        name: passkeyName.trim() || undefined,
      });
      if (res.error) {
        const errorMessage = res.error.message ?? "Could not add passkey";
        setError(errorMessage);
        toast.error("Passkey could not be added", {
          description: `${errorMessage}. Your existing sign-in methods still work.`,
        });
        return;
      }
      setPasskeyName("");
      await loadPasskeys();
      setMessage("Passkey added.");
      toast.success("Passkey added", {
        description: "You can use this device for passwordless sign-in.",
      });
    } catch {
      const errorMessage = "Passkey setup was cancelled or could not be completed";
      setError(errorMessage);
      toast.warning("Passkey was not added", {
        description: "Setup was cancelled or the device could not create a credential.",
      });
    } finally {
      setPending(false);
    }
  }

  async function deletePasskey(id: string) {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await authClient.passkey.deletePasskey({ id });
      if (res.error) {
        throw new Error(res.error.message ?? "Could not remove passkey");
      }
      await loadPasskeys();
    } finally {
      setPending(false);
    }
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
        <ConfirmActionButton
          action={disable}
          title="Disable multi-factor authentication?"
          description="Are you sure? Your authenticator and current recovery codes will stop protecting this account. Passkeys remain available."
          confirmLabel="Disable MFA"
          triggerLabel="Disable MFA"
          successTitle="MFA disabled"
          successDescription="Your authenticator is no longer required at sign-in."
          errorTitle="MFA could not be disabled"
          tone="warning"
          className="kelpie-btn kelpie-btn-secondary"
          disabled={pending || !password || mfaRequired}
        />
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

      <section
        className="space-y-3 border-t border-[color:var(--color-navy-700)] pt-4"
        aria-labelledby="passkeys-heading"
      >
        <div>
          <h2 id="passkeys-heading" className="text-lg font-medium">
            Passkeys
          </h2>
          <p className="text-sm text-slate-400">
            Use a device passkey to sign in without your password.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor="passkey-name">
            Passkey name
          </label>
          <input
            id="passkey-name"
            className="kelpie-input"
            value={passkeyName}
            onChange={(e) => setPasskeyName(e.target.value)}
            placeholder="Passkey name (optional)"
            autoComplete="off"
          />
          <button
            type="button"
            className="kelpie-btn kelpie-btn-primary shrink-0"
            onClick={addPasskey}
            disabled={pending}
          >
            Add passkey
          </button>
        </div>
        {passkeysLoading ? (
          <p className="text-sm text-slate-400">Loading passkeys...</p>
        ) : passkeys.length === 0 ? (
          <p className="text-sm text-slate-400">No passkeys added yet.</p>
        ) : (
          <ul className="space-y-2">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex items-center justify-between gap-3 rounded border border-[color:var(--color-navy-700)] p-3"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {passkey.name || "Unnamed passkey"}
                  </span>
                  {passkey.deviceType ? (
                    <span className="block text-xs text-slate-400">
                      {passkey.deviceType}
                    </span>
                  ) : null}
                </span>
                <ConfirmActionButton
                  action={async () => {
                    await deletePasskey(passkey.id);
                  }}
                  title={`Remove passkey "${passkey.name || "Unnamed passkey"}"?`}
                  description="Are you sure? This device can no longer use this passkey to sign in. Other passkeys and MFA methods remain unchanged."
                  confirmLabel="Remove passkey"
                  triggerLabel="Remove"
                  successTitle="Passkey removed"
                  successDescription="This credential can no longer sign in to Kelpie."
                  errorTitle="Passkey could not be removed"
                  className="kelpie-btn kelpie-btn-secondary shrink-0"
                  disabled={pending}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {message ? <p className="text-sm text-green-400">{message}</p> : null}
      {error ? (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
