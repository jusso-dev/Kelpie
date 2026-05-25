"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "account_locked") {
      setError("This account is locked. Contact your organisation administrator.");
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signIn.email({
      email,
      password,
      callbackURL: "/dashboard",
    });
    setPending(false);
    if ((res.data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      router.push("/two-factor");
      return;
    }
    if (res.error) {
      setError(res.error.message ?? "Sign in failed");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="kelpie-card p-6">
      <h2 className="text-lg font-medium mb-4">Sign in</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="sign-in-email"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Email
          </label>
          <input
            id="sign-in-email"
            className="kelpie-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <label
            htmlFor="sign-in-password"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Password
          </label>
          <input
            id="sign-in-password"
            className="kelpie-input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {error ? (
          <p id="sign-in-error" className="text-sm text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          className="kelpie-btn kelpie-btn-primary w-full justify-center"
          disabled={pending}
          aria-describedby={error ? "sign-in-error" : undefined}
        >
          {pending ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="text-sm text-slate-400 mt-4 text-center">
        No account yet?{" "}
        <Link href="/sign-up" className="kelpie-link">
          Create one
        </Link>
      </p>
    </div>
  );
}
