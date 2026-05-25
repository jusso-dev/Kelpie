import { db } from "@/db";
import { cases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  SeverityBadge,
  StatusBadge,
  TlpBadge,
} from "@/components/badges";

const tabs = [
  { key: "overview", label: "Overview", path: "" },
  { key: "tasks", label: "Tasks", path: "/tasks" },
  { key: "observables", label: "Observables", path: "/observables" },
  { key: "timeline", label: "Timeline", path: "/timeline" },
  { key: "comments", label: "Comments", path: "/comments" },
  { key: "attachments", label: "Attachments", path: "/attachments" },
];

type Props = {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
};

export default async function CaseLayout({ children, params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const [c] = await db
    .select()
    .from(cases)
    .where(
      and(eq(cases.id, id), eq(cases.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!c) notFound();

  const isStrict = c.tlp === "amber_strict" || c.tlp === "red";

  return (
    <div className="space-y-4">
      {isStrict ? (
        <div className="rounded-md border border-red-700 bg-red-950/40 text-red-200 px-4 py-2 text-sm">
          <strong className="font-semibold">TLP:{c.tlp.toUpperCase().replace("_", "+")}</strong>
          {" — restricted distribution. Share only with the named recipients per the TLP definition."}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/cases" className="text-xs text-slate-400 hover:text-slate-200">
            ← Back to cases
          </Link>
          <h1 className="text-2xl font-semibold mt-1">
            <span className="font-mono text-base text-slate-400 mr-2">
              {c.caseNumber}
            </span>
            {c.title}
          </h1>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StatusBadge value={c.status} />
            <SeverityBadge value={c.severity} />
            <TlpBadge value={c.tlp} />
            <span className="text-xs text-slate-500 capitalize">
              {c.classification.replace(/_/g, " ")}
            </span>
          </div>
        </div>
        <div className="flex w-full flex-col gap-2 text-sm sm:w-auto sm:flex-row sm:items-center">
          <a
            href={`/api/cases/${id}/report.md`}
            className="kelpie-btn kelpie-btn-secondary"
          >
            Markdown report
          </a>
          <a
            href={`/api/cases/${id}/report.pdf`}
            className="kelpie-btn kelpie-btn-secondary"
          >
            PDF report
          </a>
        </div>
      </div>

      <nav
        className="kelpie-scroll-x flex gap-1 border-b border-[color:var(--color-navy-700)]"
        aria-label="Case sections"
      >
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/cases/${id}${t.path}`}
            className="flex min-h-11 shrink-0 items-center rounded-t px-4 py-2 text-sm text-slate-300 hover:bg-[color:var(--color-navy-800)] hover:text-slate-100"
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
