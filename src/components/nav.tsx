import Link from "next/link";
import Image from "next/image";
import {
  Bell,
  BookOpen,
  BriefcaseBusiness,
  CircleUserRound,
  Database,
  LayoutDashboard,
  Settings,
  ShieldCheck,
} from "lucide-react";
import SignOutButton from "./sign-out-button";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/cases", label: "Cases", icon: BriefcaseBusiness },
  { href: "/observables", label: "Observables", icon: Database },
  { href: "/playbooks", label: "Playbooks", icon: BookOpen },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/account/security", label: "Security", icon: ShieldCheck },
];

export default async function Nav({
  organisationName,
  userName,
}: {
  organisationName: string;
  userName: string;
}) {
  return (
    <header className="border-b border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-950)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" className="flex min-h-11 items-center gap-2 rounded-sm">
            <Image
              src="/brand/kelpie-mark.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 rounded-full"
              aria-hidden="true"
            />
            <span className="font-semibold tracking-tight text-slate-50">
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
              className="flex min-h-11 shrink-0 items-center gap-2 rounded px-3 py-2 text-slate-300 hover:bg-[color:var(--color-navy-800)] hover:text-slate-100"
            >
              <l.icon size={16} aria-hidden="true" />
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-3 text-sm lg:flex">
          <div className="max-w-52 text-right leading-tight">
            <div className="truncate text-slate-200">{userName}</div>
            <div className="truncate text-xs text-slate-500">{organisationName}</div>
          </div>
          <CircleUserRound className="text-slate-500" size={22} aria-hidden="true" />
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
