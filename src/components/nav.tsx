"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  BriefcaseBusiness,
  CircleUserRound,
  Database,
  Globe2,
  LayoutDashboard,
  Library,
  ListChecks,
  Menu,
  Newspaper,
  Radar,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import SignOutButton from "./sign-out-button";

const links = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/cases", label: "Cases", icon: BriefcaseBusiness },
  { href: "/tasks", label: "Tasks", icon: ListChecks },
  { href: "/observables", label: "Observables", icon: Database },
  { href: "/ti", label: "Threat intel", icon: Radar },
  { href: "/briefing", label: "Cyber brief", icon: Newspaper },
  { href: "/threat-landscape", label: "Threat landscape", icon: Globe2 },
  { href: "/playbooks", label: "Playbooks", icon: BookOpen },
  { href: "/guides", label: "Guides", icon: Library },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/account/security", label: "Security", icon: ShieldCheck },
];

function NavContent({
  organisationName,
  userName,
  onNavigate,
}: {
  organisationName: string;
  userName: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <>
      <Link
        href="/dashboard"
        onClick={onNavigate}
        className="flex min-h-11 items-center gap-3 rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-tan-500)]"
      >
        <Image
          src="/brand/kelpie-mark.png"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 rounded-full"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="font-semibold tracking-tight text-slate-50">Kelpie</div>
          <div className="truncate text-xs text-slate-500">{organisationName}</div>
        </div>
      </Link>

      <nav className="mt-7 flex-1" aria-label="Primary navigation">
        <div className="px-3 pb-2 text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Workspace
        </div>
        <div className="space-y-1">
          {links.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== "/dashboard" && pathname.startsWith(`${link.href}/`));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={`group flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--color-tan-500)] ${
                  active
                    ? "bg-[color:var(--color-navy-800)] text-slate-50"
                    : "text-slate-400 hover:bg-[color:var(--color-navy-900)] hover:text-slate-100"
                }`}
              >
                <link.icon
                  size={17}
                  className={active ? "text-[color:var(--color-tan-400)]" : "text-slate-500 group-hover:text-slate-300"}
                  aria-hidden="true"
                />
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-6 border-t border-[color:var(--color-navy-700)] pt-4">
        <div className="flex items-center gap-3 px-2">
          <CircleUserRound className="shrink-0 text-slate-500" size={24} aria-hidden="true" />
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-medium text-slate-200">{userName}</div>
            <div className="truncate text-xs text-slate-500">{organisationName}</div>
          </div>
        </div>
        <SignOutButton className="mt-3 w-full justify-start" />
      </div>
    </>
  );
}

export default function Nav({
  organisationName,
  userName,
}: {
  organisationName: string;
  userName: string;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-40 flex min-h-16 items-center justify-between border-b border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-950)] px-4 lg:hidden">
        <Link href="/dashboard" className="flex min-h-11 items-center gap-2 rounded-lg">
          <Image
            src="/brand/kelpie-mark.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 rounded-full"
            aria-hidden="true"
          />
          <span className="font-semibold tracking-tight text-slate-50">Kelpie</span>
        </Link>
        <button
          type="button"
          className="kelpie-btn kelpie-btn-ghost h-11 w-11 p-0"
          aria-label="Open navigation"
          aria-controls="mobile-navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
      </header>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col overflow-y-auto border-r border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-950)] px-4 py-5 lg:flex">
        <NavContent organisationName={organisationName} userName={userName} />
      </aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[oklch(8%_0.025_260_/_0.72)]"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            id="mobile-navigation"
            className="relative flex h-full w-[min(18rem,calc(100vw-3rem))] flex-col overflow-y-auto border-r border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-950)] px-4 py-5 shadow-2xl"
          >
            <button
              type="button"
              className="kelpie-btn kelpie-btn-ghost absolute right-3 top-3 h-11 w-11 p-0"
              aria-label="Close navigation"
              onClick={() => setMobileOpen(false)}
            >
              <X size={20} aria-hidden="true" />
            </button>
            <NavContent
              organisationName={organisationName}
              userName={userName}
              onNavigate={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      ) : null}
    </>
  );
}
