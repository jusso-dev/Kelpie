import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { auditExportJobs, organisations } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { searchAuditEvents } from "@/lib/audit/search";
import { MIN_AUDIT_RETENTION_DAYS, auditRetentionDaysFromSettings } from "@/lib/audit/retention";
import { requestAuditExport } from "@/actions/audit";
import { auditFiltersFromSource } from "@/lib/audit/filters";
import LocalDateTime from "@/components/local-date-time";
import AuditRetentionSettings from "@/components/audit-retention-settings";

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_KEYS = ["action", "actorId", "targetType", "targetId", "from", "to", "q"] as const;

function first(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? "";
}

function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    const scalar = Array.isArray(value) ? value[0] : value;
    if (typeof scalar === "string" && scalar) params.set(key, scalar);
  }
  return params;
}

function queryString(
  filterValues: Record<string, string>,
  overrides: Record<string, string | undefined> = {},
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filterValues, ...overrides })) {
    if (value) params.set(key, value);
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

async function submitAuditExport(formData: FormData): Promise<void> {
  "use server";
  await requestAuditExport(formData);
}

export default async function AuditExplorerPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const user = await requireRole(["admin"]);
  const raw = await searchParams;
  const filterParams = toSearchParams(raw);
  const filters = auditFiltersFromSource(filterParams);
  const cursor = first(raw.cursor) || null;

  const filterValues = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, first(raw[key])]),
  ) as Record<(typeof FILTER_KEYS)[number], string>;

  const [{ events, nextCursor }, exportJobs, [org]] = await Promise.all([
    searchAuditEvents(user.organisationId, filters, { cursor }),
    db
      .select()
      .from(auditExportJobs)
      .where(eq(auditExportJobs.organisationId, user.organisationId))
      .orderBy(desc(auditExportJobs.createdAt))
      .limit(20),
    db
      .select({ settings: organisations.settings })
      .from(organisations)
      .where(eq(organisations.id, user.organisationId))
      .limit(1),
  ]);

  const retentionDays = auditRetentionDaysFromSettings(org?.settings);

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Audit log</h1>
        <p>
          Every recorded action across your organisation, with export and
          retention controls.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Filters</h2>
          <p>Narrow the log by action, actor, target, time range, or free text.</p>
        </div>
        <form method="get" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="kelpie-field">
            <label htmlFor="filter-action" className="kelpie-label">Action</label>
            <input
              id="filter-action"
              name="action"
              defaultValue={filterValues.action}
              className="kelpie-input"
              placeholder="case.status_changed"
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-actorId" className="kelpie-label">Actor ID</label>
            <input
              id="filter-actorId"
              name="actorId"
              defaultValue={filterValues.actorId}
              className="kelpie-input"
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-targetType" className="kelpie-label">Target type</label>
            <input
              id="filter-targetType"
              name="targetType"
              defaultValue={filterValues.targetType}
              className="kelpie-input"
              placeholder="case"
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-targetId" className="kelpie-label">Target ID</label>
            <input
              id="filter-targetId"
              name="targetId"
              defaultValue={filterValues.targetId}
              className="kelpie-input"
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-from" className="kelpie-label">From</label>
            <input
              id="filter-from"
              type="datetime-local"
              name="from"
              defaultValue={filterValues.from}
              className="kelpie-input"
            />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-to" className="kelpie-label">To</label>
            <input
              id="filter-to"
              type="datetime-local"
              name="to"
              defaultValue={filterValues.to}
              className="kelpie-input"
            />
          </div>
          <div className="kelpie-field sm:col-span-2 lg:col-span-4">
            <label htmlFor="filter-q" className="kelpie-label">Free text</label>
            <input
              id="filter-q"
              name="q"
              defaultValue={filterValues.q}
              className="kelpie-input"
              placeholder="Search action, target, or actor"
            />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="kelpie-btn kelpie-btn-primary">
              Apply filters
            </button>
            <Link href="/settings/audit" className="kelpie-btn kelpie-btn-ghost">
              Clear filters
            </Link>
          </div>
        </form>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Events</h2>
          <p>Most recent first.</p>
        </div>
        {events.length === 0 ? (
          <p className="text-sm text-slate-400">No audit events match these filters.</p>
        ) : (
          <div className="kelpie-scroll-x" tabIndex={0} aria-label="Audit events table">
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Occurred</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Source IP</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap text-xs text-slate-400">
                      <LocalDateTime
                        value={event.occurredAt.toISOString()}
                        timeZone={user.timezone}
                      />
                    </td>
                    <td className="text-xs text-slate-300">
                      {event.actorLabel ?? event.actorId ?? event.actorType}
                    </td>
                    <td className="font-mono text-xs text-slate-200">{event.action}</td>
                    <td className="text-xs text-slate-300">
                      {event.targetType}
                      {event.targetId ? `:${event.targetId}` : ""}
                      {event.targetLabel ? ` (${event.targetLabel})` : ""}
                    </td>
                    <td className="text-xs text-slate-400">{event.sourceIp ?? ""}</td>
                    <td className="text-right">
                      <Link
                        href={`/settings/audit/${event.id}`}
                        className="kelpie-link text-xs"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor ? (
          <Link
            href={`/settings/audit${queryString(filterValues, { cursor: nextCursor })}`}
            className="kelpie-btn kelpie-btn-secondary"
          >
            Load more
          </Link>
        ) : null}
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Export</h2>
          <p>Exports enforce the same filters and permissions as this page.</p>
        </div>
        <form action={submitAuditExport} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="action" value={filterValues.action} />
          <input type="hidden" name="actorId" value={filterValues.actorId} />
          <input type="hidden" name="targetType" value={filterValues.targetType} />
          <input type="hidden" name="targetId" value={filterValues.targetId} />
          <input type="hidden" name="from" value={filterValues.from} />
          <input type="hidden" name="to" value={filterValues.to} />
          <input type="hidden" name="q" value={filterValues.q} />
          <div className="kelpie-field">
            <label htmlFor="export-format" className="kelpie-label">Format</label>
            <select id="export-format" name="format" className="kelpie-input" defaultValue="csv">
              <option value="csv">CSV</option>
              <option value="ndjson">NDJSON</option>
            </select>
          </div>
          <button type="submit" className="kelpie-btn kelpie-btn-primary">
            Request export
          </button>
        </form>

        {exportJobs.length > 0 ? (
          <div className="kelpie-scroll-x mt-4" tabIndex={0} aria-label="Export jobs table">
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Requested</th>
                  <th>Format</th>
                  <th>Status</th>
                  <th>Rows</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {exportJobs.map((job) => (
                  <tr key={job.id}>
                    <td className="whitespace-nowrap text-xs text-slate-400">
                      <LocalDateTime
                        value={job.createdAt.toISOString()}
                        timeZone={user.timezone}
                      />
                    </td>
                    <td className="text-xs uppercase text-slate-300">{job.format}</td>
                    <td className="text-xs capitalize text-slate-300">{job.status}</td>
                    <td className="text-xs text-slate-400">{job.rowCount ?? ""}</td>
                    <td className="text-right">
                      {job.status === "completed" ? (
                        <a
                          href={`/api/audit-events/exports/${job.id}/download`}
                          className="kelpie-link text-xs"
                        >
                          Download
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-400">No exports requested yet.</p>
        )}
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Retention</h2>
          <p>
            Audit events older than the retention window are purged automatically.
            The minimum allowed retention is a safe floor and cannot be lowered
            further.
          </p>
        </div>
        <AuditRetentionSettings currentDays={retentionDays} minDays={MIN_AUDIT_RETENTION_DAYS} />
      </section>
    </div>
  );
}
