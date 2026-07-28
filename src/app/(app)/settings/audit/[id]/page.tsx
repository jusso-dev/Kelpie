import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getAuditEventDetail } from "@/lib/audit/search";
import LocalDateTime from "@/components/local-date-time";
import MissingRecord from "@/components/missing-record";

export default async function AuditEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireRole(["admin"]);
  const { id } = await params;
  const event = await getAuditEventDetail(user.organisationId, id);

  if (!event) {
    return (
      <MissingRecord
        record="Audit event"
        description="This audit event may not exist, or it may belong to another organisation."
        primaryHref="/settings/audit"
        primaryLabel="Back to audit log"
      />
    );
  }

  return (
    <div className="kelpie-page max-w-4xl">
      <header>
        <Link href="/settings/audit" className="text-xs text-slate-400 hover:text-slate-200">
          ← Audit log
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{event.action}</h1>
        <p>
          <LocalDateTime value={event.occurredAt.toISOString()} timeZone={user.timezone} />
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Summary</h2>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Event ID" value={event.id} />
          <Field label="Request ID" value={event.requestId ?? "—"} />
          <Field label="Actor type" value={event.actorType} />
          <Field label="Actor ID" value={event.actorId ?? "—"} />
          <Field label="Actor label" value={event.actorLabel ?? "—"} />
          <Field label="Action" value={event.action} />
          <Field label="Target type" value={event.targetType} />
          <Field label="Target ID" value={event.targetId ?? "—"} />
          <Field label="Target label" value={event.targetLabel ?? "—"} />
          <Field label="Source IP" value={event.sourceIp ?? "—"} />
          <Field label="User agent" value={event.userAgent ?? "—"} />
        </dl>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Before</h2>
        </div>
        <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
          {JSON.stringify(event.before, null, 2)}
        </pre>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>After</h2>
        </div>
        <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
          {JSON.stringify(event.after, null, 2)}
        </pre>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Metadata</h2>
        </div>
        <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
          {JSON.stringify(event.metadata, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200 break-all">{value}</dd>
    </div>
  );
}
