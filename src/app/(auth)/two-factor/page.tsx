"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await fetch("/api/auth/two-factor/verify-totp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, trustDevice: true }),
    });
    setPending(false);
    if (!res.ok) {
      setError("Invalid two-factor code");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="kelpie-card p-6">
      <h2 className="text-lg font-medium mb-4">Two-factor verification</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="two-factor-code"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Authenticator code
          </label>
          <input
            id="two-factor-code"
            className="kelpie-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        {error ? (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="kelpie-btn kelpie-btn-primary w-full"
          disabled={pending}
        >
          {pending ? "Verifying..." : "Verify"}
        </button>
      </form>
    </div>
  );
}
