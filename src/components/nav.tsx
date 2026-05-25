import Link from "next/link";
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
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" className="flex min-h-11 items-center gap-2 rounded-sm">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full bg-[color:var(--color-tan-500)]"
            aria-hidden="true"
          />
          <span className="font-semibold tracking-tight text-[color:var(--color-tan-400)]">
            Kelpie
          </span>
          </Link>
          <div className="flex items-center gap-3 text-sm lg:hidden">
            <div className="min-w-0 text-right leading-tight">
              <div className="truncate text-slate-200">{userName}</div>
              <div className="truncate text-xs text-slate-500">{organisationName}</div>
            </div>
            <SignOutButton />
          </div>
        </div>
        <nav
          className="kelpie-scroll-x -mx-4 flex items-center gap-1 px-4 text-sm sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0"
          aria-label="Primary navigation"
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="flex min-h-11 shrink-0 items-center rounded px-3 py-2 text-slate-300 hover:bg-[color:var(--color-navy-800)] hover:text-slate-100"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-3 text-sm lg:flex">
          <div className="max-w-52 text-right leading-tight">
            <div className="truncate text-slate-200">{userName}</div>
            <div className="truncate text-xs text-slate-500">{organisationName}</div>
          </div>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
