import Link from "next/link";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import SignOutButton from "./sign-out-button";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/alerts", label: "Alerts" },
  { href: "/cases", label: "Cases" },
  { href: "/observables", label: "Observables" },
  { href: "/playbooks", label: "Playbooks" },
  { href: "/settings", label: "Settings" },
];

export default async function Nav({
  organisationName,
  userName,
}: {
  organisationName: string;
  userName: string;
}) {
  return (
    <header className="border-b border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)]">
      <div className="mx-auto max-w-7xl px-6 py-3 flex items-center gap-6">
        <Link href="/dashboard" className="flex items-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[color:var(--color-tan-500)]" />
          <span className="font-semibold tracking-tight text-[color:var(--color-tan-400)]">
            Kelpie
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="px-3 py-1.5 rounded text-slate-300 hover:text-white hover:bg-[color:var(--color-navy-800)]"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <div className="text-right leading-tight">
            <div className="text-slate-200">{userName}</div>
            <div className="text-xs text-slate-500">{organisationName}</div>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
