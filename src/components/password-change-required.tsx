"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { changeOwnPassword } from "@/actions/account";

const initialState = { ok: false, error: null };

export default function PasswordChangeRequired() {
  const router = useRouter();
  const [state, action, pending] = useActionState(changeOwnPassword, initialState);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
    }
  }, [router, state.ok]);

  return (
    <div className="kelpie-card mx-auto max-w-xl p-6">
      <h1 className="text-2xl font-semibold">Change password</h1>
      <p className="mt-2 text-sm text-slate-400">
        Your password was reset by an administrator. Choose a new password to
        continue.
      </p>
      <form action={action} className="mt-5 space-y-4">
        <PasswordField
          id="current-password"
          label="Temporary password"
          name="currentPassword"
          autoComplete="current-password"
        />
        <PasswordField
          id="new-password"
          label="New password"
          name="newPassword"
          autoComplete="new-password"
        />
        <PasswordField
          id="confirm-password"
          label="Confirm new password"
          name="confirmPassword"
          autoComplete="new-password"
        />
        {state.error ? (
          <p className="text-sm text-red-400" role="alert">
            {state.error}
          </p>
        ) : null}
        <button
          className="kelpie-btn kelpie-btn-primary w-full justify-center"
          disabled={pending}
        >
          {pending ? "Changing password..." : "Change password"}
        </button>
      </form>
    </div>
  );
}

function PasswordField({
  id,
  label,
  name,
  autoComplete,
}: {
  id: string;
  label: string;
  name: string;
  autoComplete: string;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs uppercase tracking-wider text-slate-400"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="password"
        className="kelpie-input"
        autoComplete={autoComplete}
        required
      />
    </div>
  );
}
