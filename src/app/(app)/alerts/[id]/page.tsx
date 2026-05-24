import { db } from "@/db";
import { alerts, observables, cases } from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  AlertStatusBadge,
  SeverityBadge,
} from "@/components/badges";
import { formatDistanceToNow } from "date-fns";
import { dismissAlerts, promoteAlertToCase } from "@/actions/alerts";

type Props = { params: Promise<{ id: string }> };

export default async function AlertDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const [alert] = await db
    .select()
    .from(alerts)
    .where(
      and(eq(alerts.id, id), eq(alerts.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!alert) notFound();

  // Surface duplicates: any recent alert that shares an observable value.
  const alertObs = Array.isArray(alert.observables)
    ? (alert.observables as Array<{ type?: string; value?: string }>)
    : [];
  const values = alertObs.map((o) => o.value).filter((v): v is string => Boolean(v));
  let relatedCases: Array<{ id: string; caseNumber: string; title: string; value: string }> = [];
  if (values.length > 0) {
    const matches = await db
      .select({
        id: cases.id,
        caseNumber: cases.caseNumber,
        title: cases.title,
        value: observables.value,
      })
      .from(observables)
      .innerJoin(cases, eq(cases.id, observables.caseId))
      .where(
        and(
          eq(cases.organisationId, user.organisationId),
          inArray(observables.value, values),
        ),
      )
      .limit(20);
    relatedCases = matches;
  }

  async function promote() {
    "use server";
    const result = await promoteAlertToCase(id);
    redirect(`/cases/${result.caseId}`);
  }

  async function dismiss() {
    "use server";
    await dismissAlerts([id]);
    redirect("/alerts");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/alerts" className="text-xs text-slate-400 hover:text-slate-200">
            ← Back to alerts
          </Link>
          <h1 className="text-2xl font-semibold mt-1">{alert.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-slate-400">
            <span>{alert.source}</span>
            <span>•</span>
            <span>{formatDistanceToNow(alert.createdAt, { addSuffix: true })}</span>
            <AlertStatusBadge value={alert.status} />
            <SeverityBadge value={alert.severity} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {alert.promotedCaseId ? (
            <Link
              href={`/cases/${alert.promotedCaseId}`}
              className="kelpie-btn kelpie-btn-primary"
            >
              Open the case →
            </Link>
          ) : (
            <>
              <form action={dismiss}>
                <button className="kelpie-btn kelpie-btn-secondary">
                  Dismiss
                </button>
              </form>
              <form action={promote}>
                <button className="kelpie-btn kelpie-btn-primary">
                  Promote to case
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-2">Description</h2>
          <p className="text-sm text-slate-200 whitespace-pre-wrap">
            {alert.description || <span className="text-slate-500">No description.</span>}
          </p>
          <h2 className="text-sm font-medium text-slate-300 mt-5 mb-2">
            Observables
          </h2>
          {alertObs.length === 0 ? (
            <p className="text-sm text-slate-500">No observables on this alert.</p>
          ) : (
            <ul className="text-sm space-y-1 font-mono">
              {alertObs.map((o, i) => (
                <li key={i}>
                  <span className="text-slate-500">{o.type ?? "other"}:</span>{" "}
                  <span className="text-slate-200">{o.value}</span>
                </li>
              ))}
            </ul>
          )}
          <h2 className="text-sm font-medium text-slate-300 mt-5 mb-2">
            Raw payload
          </h2>
          <pre className="text-xs bg-[color:var(--color-navy-800)] p-3 rounded overflow-auto">
            {JSON.stringify(alert.rawPayload, null, 2)}
          </pre>
        </div>
        <div className="kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-2">
            Related cases (shared observables)
          </h2>
          {relatedCases.length === 0 ? (
            <p className="text-sm text-slate-500">
              No prior cases with matching observables.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {relatedCases.map((m) => (
                <li key={`${m.id}-${m.value}`} className="border-b border-[color:var(--color-navy-800)] pb-2">
                  <Link href={`/cases/${m.id}`} className="kelpie-link">
                    {m.caseNumber} {m.title}
                  </Link>
                  <div className="text-xs text-slate-500 font-mono">{m.value}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
