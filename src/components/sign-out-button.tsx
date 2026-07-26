"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut } from "@/lib/auth-client";

export default function SignOutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={`kelpie-btn kelpie-btn-ghost text-slate-300 ${className}`}
      onClick={async () => {
        await signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      <LogOut size={16} aria-hidden="true" />
      Sign out
    </button>
  );
}
