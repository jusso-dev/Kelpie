import { db } from "@/db";
import { cases, observables } from "@/db/schema";
import { and, eq, ilike, desc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import Link from "next/link";
import { TlpBadge } from "@/components/badges";

type SearchParams = Promise<{ q?: string; type?: string }>;

export default async function ObservablesSearchPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const q = (params.q ?? "").trim();

  let rows: Array<{
    id: string;
    type: string;
    value: string;
    tlp: string;
    isIoc: boolean;
    caseId: string;
    caseNumber: string;
    caseTitle: string;
  }> = [];

  if (q) {
    rows = await db
      .select({
        id: observables.id,
        type: observables.type,
        value: observables.value,
        tlp: observables.tlp,
        isIoc: observables.isIoc,
        caseId: cases.id,
        caseNumber: cases.caseNumber,
        caseTitle: cases.title,
      })
      .from(observables)
      .innerJoin(cases, eq(cases.id, observables.caseId))
      .where(
        and(
          eq(cases.organisationId, user.organisationId),
          ilike(observables.value, `%${q}%`),
        ),
      )
      .orderBy(desc(observables.createdAt))
      .limit(200);
  }

  // Group by value so the analyst can see a campaign at a glance.
  const grouped = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = grouped.get(r.value) ?? [];
    list.push(r);
    grouped.set(r.value, list);
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Observable search</h1>
        <p className="text-sm text-slate-400">
          Cross-case lookup. Find every case an indicator turned up in.
        </p>
      </header>

      <form className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="observable-query" className="kelpie-sr-only">
          Observable value
        </label>
        <input
          id="observable-query"
          name="q"
          defaultValue={q}
          placeholder="IP, domain, hash, email..."
          className="kelpie-input font-mono"
        />
        <button className="kelpie-btn kelpie-btn-primary">Search</button>
      </form>

      {!q ? (
        <div className="kelpie-card p-8 text-center text-sm text-slate-500">
          Enter a value to look up.
        </div>
      ) : grouped.size === 0 ? (
        <div className="kelpie-card p-8 text-center text-sm text-slate-500">
          No matches.
        </div>
      ) : (
        <div className="space-y-4">
          {[...grouped.entries()].map(([value, list]) => (
            <div key={value} className="kelpie-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-slate-100">{value}</span>
                <span className="text-xs text-slate-500">
                  ({list.length} case{list.length === 1 ? "" : "s"})
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {list.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-col gap-1 border-t border-[color:var(--color-navy-800)] py-2 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <span className="w-24 text-xs uppercase text-slate-500">
                      {r.type.replace(/_/g, " ")}
                    </span>
                    <Link href={`/cases/${r.caseId}`} className="kelpie-link">
                      {r.caseNumber} {r.caseTitle}
                    </Link>
                    <span className="flex items-center gap-2 sm:ml-auto">
                      <TlpBadge value={r.tlp} />
                      {r.isIoc ? (
                        <span className="kelpie-badge text-amber-400">IOC</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
