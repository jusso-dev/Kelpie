"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth-client";

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organisationName, setOrganisationName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const res = await signUp.email({ name, email, password });
    if (res.error) {
      setPending(false);
      setError(res.error.message ?? "Sign up failed");
      return;
    }
    // Attach organisation on first sign-in.
    const onboard = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ organisationName }),
    });
    setPending(false);
    if (!onboard.ok) {
      setError("Failed to create organisation");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="kelpie-card p-6">
      <h2 className="text-lg font-medium mb-4">Create account</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Your name
          </label>
          <input
            className="kelpie-input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Organisation name
          </label>
          <input
            className="kelpie-input"
            required
            value={organisationName}
            onChange={(e) => setOrganisationName(e.target.value)}
            placeholder="Acme SOC"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Email
          </label>
          <input
            className="kelpie-input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </div>
        <div>
          <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Password
          </label>
          <input
            className="kelpie-input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        <button
          type="submit"
          className="kelpie-btn kelpie-btn-primary w-full justify-center"
          disabled={pending}
        >
          {pending ? "Creating..." : "Create account"}
        </button>
      </form>
      <p className="text-sm text-slate-400 mt-4 text-center">
        Already registered?{" "}
        <Link href="/sign-in" className="kelpie-link">
          Sign in
        </Link>
      </p>
    </div>
  );
}
