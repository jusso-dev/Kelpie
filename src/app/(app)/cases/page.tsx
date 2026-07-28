import Link from "next/link";
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, Filter, Search, X } from "lucide-react";
import { db } from "@/db";
import {
  attackCatalogVersions,
  attackTechniqueMappings,
  attackTechniques,
  cases,
  queues,
  users,
} from "@/db/schema";
import { requireUser } from "@/lib/session";
import { caseSlaAtRiskSql, caseSlaBreachedSql, caseSlaWarningSql } from "@/lib/sla";
import { listQueuesCore } from "@/lib/queues-core";
import { listWatchedCaseIdsCore } from "@/lib/watchers-core";
import { ATTACK_TACTICS } from "@/lib/attack/tactics";
import {
  SeverityBadge,
  StatusBadge,
  TagBadge,
  TlpBadge,
} from "@/components/badges";
import {
  KNOWN_PUSH_SOURCE_SYSTEMS,
  sourceSystemLabel,
} from "@/lib/case-source-identity";
import { BulkActionsBar } from "@/components/bulk-actions-bar";

const PAGE_SIZE = 50;
const STATUSES = [
  "open",
  "in_progress",
  "contained",
  "eradicated",
  "recovered",
  "closed",
] as const;
const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const CLASSIFICATIONS = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
] as const;
const TLPS = ["clear", "green", "amber", "amber_strict", "red"] as const;
const SORTS = ["priority", "recent", "oldest", "severity"] as const;

// Built-in operational views (#54). Each maps to an indexed predicate below;
// picking one composes with, rather than replaces, the other filters.
const VIEWS = [
  "unassigned",
  "mine",
  "watched",
  "sla_warning",
  "sla_breached",
  "awaiting_third_party",
  "awaiting_approval",
  "stale_investigation",
  "recently_reopened",
] as const;
const VIEW_LABELS: Record<(typeof VIEWS)[number], string> = {
  unassigned: "Unassigned",
  mine: "My cases",
  watched: "Watched cases",
  sla_warning: "SLA warning",
  sla_breached: "SLA breached",
  awaiting_third_party: "Awaiting third party",
  awaiting_approval: "Awaiting approval",
  stale_investigation: "Stale investigation",
  recently_reopened: "Recently reopened",
};

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;
type TeamMember = { id: string; name: string };
type SourceOption = { value: string; label: string };
type QueueParams = {
  q?: string;
  status?: (typeof STATUSES)[number];
  severity?: (typeof SEVERITIES)[number];
  classification?: (typeof CLASSIFICATIONS)[number];
  tlp?: (typeof TLPS)[number];
  assignee?: string;
  queueId?: string;
  view?: (typeof VIEWS)[number];
  tag?: string;
  dataTag?: string;
  source?: string;
  technique?: string;
  tactic?: string;
  sla?: "risk";
  sort: (typeof SORTS)[number];
  page: number;
};

// Bare push-producer slugs (e.g. `tawny`) and managed-connector namespaces
// (e.g. `microsoft_sentinel:src_123`) are both valid; the colon is required
// so connector rows stay filterable by their exact source.
const SOURCE_PATTERN = /^[a-z0-9][a-z0-9_:-]*$/;

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

function pick<const T extends readonly string[]>(
  values: T,
  raw: string | undefined,
): T[number] | undefined {
  return raw && (values as readonly string[]).includes(raw)
    ? (raw as T[number])
    : undefined;
}

function cleanText(raw: string | undefined, max: number): string | undefined {
  const value = raw?.trim().slice(0, max);
  return value || undefined;
}

function normaliseSource(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase().slice(0, 64);
  return value && SOURCE_PATTERN.test(value) ? value : undefined;
}

function normaliseParams(
  raw: Record<string, string | string[] | undefined>,
  team: TeamMember[],
  queueOptions: Array<{ id: string }>,
): QueueParams {
  const rawAssignee = first(raw.assignee);
  const assignee =
    rawAssignee === "mine" || rawAssignee === "unassigned"
      ? rawAssignee
      : team.some((member) => member.id === rawAssignee)
        ? rawAssignee
        : undefined;
  const rawQueueId = first(raw.queueId);
  const queueId =
    rawQueueId === "none" || queueOptions.some((q) => q.id === rawQueueId)
      ? rawQueueId
      : undefined;
  const rawPage = Number(first(raw.page));
  return {
    q: cleanText(first(raw.q), 120),
    status: pick(STATUSES, first(raw.status)),
    severity: pick(SEVERITIES, first(raw.severity)),
    classification: pick(CLASSIFICATIONS, first(raw.classification)),
    tlp: pick(TLPS, first(raw.tlp)),
    assignee,
    queueId,
    view: pick(VIEWS, first(raw.view)),
    tag: cleanText(first(raw.tag), 60),
    dataTag: cleanText(first(raw.dataTag), 60),
    source: normaliseSource(first(raw.source)),
    technique: cleanText(first(raw.technique), 32)?.toUpperCase(),
    tactic: ATTACK_TACTICS.some((t) => t.id === first(raw.tactic)) ? first(raw.tactic) : undefined,
    sla: first(raw.sla) === "risk" ? "risk" : undefined,
    sort: pick(SORTS, first(raw.sort)) ?? "priority",
    page:
      Number.isInteger(rawPage) && rawPage > 0
        ? Math.min(rawPage, 10_000)
        : 1,
  };
}

function queryString(
  current: QueueParams,
  updates: Partial<Record<keyof QueueParams, string | number | undefined>>,
): string {
  const merged = { ...current, ...updates };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined && value !== "" && !(key === "sort" && value === "priority")) {
      params.set(key, String(value));
    }
  }
  const value = params.toString();
  return value ? `?${value}` : "";
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const user = await requireUser();
  const canBulk = user.role === "admin" || user.role === "analyst";
  const [rawParams, team, sourceSystemRows, queueOptions, watchedCaseIds] =
    await Promise.all([
      searchParams,
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.organisationId, user.organisationId))
        .orderBy(asc(users.name)),
      db
        .selectDistinct({ sourceSystem: cases.sourceSystem })
        .from(cases)
        .where(
          and(
            eq(cases.organisationId, user.organisationId),
            isNotNull(cases.sourceSystem),
          ),
        )
        .orderBy(asc(cases.sourceSystem))
        .limit(50),
      listQueuesCore(user.organisationId),
      listWatchedCaseIdsCore(user.organisationId, user.id),
    ]);
  const params = normaliseParams(rawParams, team, queueOptions);
  // Known push producers (e.g. Tawny) are always offered even if this org has
  // no cases yet; managed connectors are only offered once observed, since
  // their identifiers are per-org connection ids.
  const sourceSystemOptions: SourceOption[] = Array.from(
    new Set([
      ...KNOWN_PUSH_SOURCE_SYSTEMS,
      ...sourceSystemRows
        .map((row) => row.sourceSystem)
        .filter((value): value is string => Boolean(value)),
    ]),
  )
    .map((value) => ({ value, label: sourceSystemLabel(value) ?? value }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const filters = [eq(cases.organisationId, user.organisationId)];

  if (params.q) {
    filters.push(
      or(
        ilike(cases.caseNumber, `%${params.q}%`),
        ilike(cases.title, `%${params.q}%`),
      )!,
    );
  }
  if (params.status) filters.push(eq(cases.status, params.status));
  if (params.severity) filters.push(eq(cases.severity, params.severity));
  if (params.classification) {
    filters.push(eq(cases.classification, params.classification));
  }
  if (params.tlp) filters.push(eq(cases.tlp, params.tlp));
  if (params.assignee === "mine") {
    filters.push(eq(cases.assigneeId, user.id));
  } else if (params.assignee === "unassigned") {
    filters.push(isNull(cases.assigneeId));
  } else if (params.assignee) {
    filters.push(eq(cases.assigneeId, params.assignee));
  }
  if (params.tag) filters.push(sql`${cases.tags} ? ${params.tag}`);
  if (params.dataTag) {
    filters.push(sql`${cases.dataClassificationTags} ? ${params.dataTag}`);
  }
  if (params.source) filters.push(eq(cases.sourceSystem, params.source));
  if (params.queueId === "none") {
    filters.push(isNull(cases.queueId));
  } else if (params.queueId) {
    filters.push(eq(cases.queueId, params.queueId));
  }
  if (params.technique) {
    filters.push(
      sql`EXISTS (SELECT 1 FROM ${attackTechniqueMappings} m WHERE m.case_id = ${cases.id} AND m.technique_id = ${params.technique})`,
    );
  }
  if (params.tactic) {
    filters.push(
      sql`EXISTS (
        SELECT 1 FROM ${attackTechniqueMappings} m
        WHERE m.case_id = ${cases.id}
          AND EXISTS (
            SELECT 1 FROM ${attackTechniques} t
            WHERE t.technique_id = m.technique_id
              AND t.catalog_version_id = (
                SELECT id FROM ${attackCatalogVersions} WHERE status = 'active' LIMIT 1
              )
              AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.tactics) elem WHERE elem->>'id' = ${params.tactic})
          )
      )`,
    );
  }

  const slaRisk = caseSlaAtRiskSql();
  if (params.sla === "risk") filters.push(slaRisk);

  // Built-in operational views (#54): each is an indexed predicate, not a
  // client-side filter, so counts/pagination stay correct for the whole view.
  switch (params.view) {
    case "unassigned":
      filters.push(isNull(cases.assigneeId));
      break;
    case "mine":
      filters.push(
        or(
          eq(cases.assigneeId, user.id),
          sql`exists (select 1 from case_assignees ca where ca.case_id = ${cases.id} and ca.user_id = ${user.id})`,
        )!,
      );
      break;
    case "watched":
      filters.push(
        watchedCaseIds.length > 0 ? inArray(cases.id, watchedCaseIds) : sql`false`,
      );
      break;
    case "sla_warning":
      filters.push(caseSlaWarningSql());
      break;
    case "sla_breached":
      filters.push(caseSlaBreachedSql());
      break;
    case "awaiting_third_party":
      filters.push(eq(cases.waitingReason, "third_party"));
      break;
    case "awaiting_approval":
      filters.push(eq(cases.waitingReason, "approval"));
      break;
    case "stale_investigation":
      filters.push(
        sql`${cases.status} = 'in_progress' and now() - ${cases.lastActivityAt} > interval '3 days'`,
      );
      break;
    case "recently_reopened":
      filters.push(
        sql`${cases.lastReopenedAt} is not null and now() - ${cases.lastReopenedAt} < interval '7 days'`,
      );
      break;
  }

  const where = and(...filters);
  const [metrics] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) filter (where ${cases.status} <> 'closed')`,
      critical: sql<number>`count(*) filter (where ${cases.severity} = 'critical')`,
      high: sql<number>`count(*) filter (where ${cases.severity} = 'high')`,
    })
    .from(cases)
    .where(where);

  const total = Number(metrics?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(params.page, totalPages);
  params.page = page;
  const severityRank = sql<number>`case ${cases.severity}
    when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;
  const orderBy =
    params.sort === "oldest"
      ? [asc(cases.openedAt), asc(cases.id)]
      : params.sort === "recent"
        ? [desc(cases.openedAt), desc(cases.id)]
        : params.sort === "severity"
          ? [asc(severityRank), desc(cases.openedAt), desc(cases.id)]
          : [
              asc(sql`case when ${cases.status} = 'closed' then 1 else 0 end`),
              desc(slaRisk),
              asc(severityRank),
              asc(sql`case when ${cases.assigneeId} = ${user.id} then 0 else 1 end`),
              desc(cases.openedAt),
              desc(cases.id),
            ];

  const rows = await db
    .select({
      id: cases.id,
      caseNumber: cases.caseNumber,
      title: cases.title,
      status: cases.status,
      severity: cases.severity,
      tlp: cases.tlp,
      classification: cases.classification,
      tags: cases.tags,
      dataClassificationTags: cases.dataClassificationTags,
      assigneeName: users.name,
      queueName: queues.name,
      openedAt: cases.openedAt,
      slaRisk,
    })
    .from(cases)
    .leftJoin(users, eq(users.id, cases.assigneeId))
    .leftJoin(queues, eq(queues.id, cases.queueId))
    .where(where)
    .orderBy(...orderBy)
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // Counts truthy filters for the "Clear N" affordance; the human-readable
  // form of each value (e.g. "Source: Tawny") is what the corresponding
  // <SelectFilter> shows as its selected option, via sourceSystemLabel.
  const activeFilters = [
    params.q,
    params.status,
    params.severity,
    params.classification,
    params.tlp,
    params.assignee,
    params.queueId,
    params.view,
    params.tag,
    params.dataTag,
    params.source,
    params.technique,
    params.tactic,
    params.sla,
  ].filter(Boolean).length;
  const firstResult = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="space-y-5">
      <header className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div>
          <div className="mb-2 inline-flex items-center rounded-full border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] px-3 py-1 text-xs font-medium text-[color:var(--color-tan-300)]">
            Case queue
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
            Security incidents, evidence, and response status.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Search the queue, isolate urgent work, and keep ownership and SLA
            pressure visible during triage.
          </p>
        </div>
        <div className="kelpie-panel grid grid-cols-3 gap-3 p-4">
          <QueueMetric label="Active" value={Number(metrics?.active ?? 0)} />
          <QueueMetric
            label="Critical"
            value={Number(metrics?.critical ?? 0)}
            hot
          />
          <QueueMetric label="High" value={Number(metrics?.high ?? 0)} />
          <Link href="/cases/new" className="kelpie-btn kelpie-btn-primary col-span-3">
            New case
            <ArrowUpRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>

      <nav aria-label="Built-in views" className="flex flex-wrap gap-2">
        {VIEWS.map((view) => (
          <Link
            key={view}
            href={`/cases${queryString(params, { view: params.view === view ? undefined : view, page: undefined })}`}
            className={
              "kelpie-badge " +
              (params.view === view
                ? "border border-[color:var(--color-tan-400)] text-[color:var(--color-tan-300)]"
                : "text-slate-300")
            }
            aria-current={params.view === view ? "true" : undefined}
          >
            {VIEW_LABELS[view]}
          </Link>
        ))}
      </nav>

      <QueueFilters
        params={params}
        team={team}
        queueOptions={queueOptions}
        sourceOptions={sourceSystemOptions}
        activeFilters={activeFilters}
      />

      {canBulk ? (
        <BulkActionsBar
          formId="bulk-case-form"
          queues={queueOptions}
          members={team}
        />
      ) : null}

      <div className="flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite">
          Showing {firstResult}-{lastResult} of {total} matching case
          {total === 1 ? "" : "s"}
        </p>
        <p>Page {page} of {totalPages}</p>
      </div>

      <div className="kelpie-panel kelpie-scroll-x" tabIndex={0} aria-label="Cases table">
        <table className="kelpie-table">
          <thead>
            <tr>
              {canBulk ? <th><span className="sr-only">Select</span></th> : null}
              <th>Number</th>
              <th>Title</th>
              <th>Status</th>
              <th>Severity</th>
              <th>SLA</th>
              <th>TLP</th>
              <th>Classification</th>
              <th>Tags</th>
              <th>Queue</th>
              <th>Assignee</th>
              <th>Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={canBulk ? 12 : 11} className="py-10 text-center text-slate-400">
                  <p>No cases match these filters.</p>
                  {activeFilters > 0 ? (
                    <Link href="/cases" className="kelpie-link mt-2 inline-block">
                      Clear filters
                    </Link>
                  ) : (
                    <Link href="/cases/new" className="kelpie-link mt-2 inline-block">
                      Open the first case
                    </Link>
                  )}
                </td>
              </tr>
            ) : (
              rows.map((c) => (
                <tr key={c.id}>
                  {canBulk ? (
                    <td>
                      <input
                        type="checkbox"
                        name="caseIds"
                        value={c.id}
                        form="bulk-case-form"
                        aria-label={`Select case ${c.caseNumber}`}
                      />
                    </td>
                  ) : null}
                  <td className="font-mono text-xs text-slate-400">{c.caseNumber}</td>
                  <td className="max-w-sm">
                    <Link href={`/cases/${c.id}`} className="kelpie-link font-medium">
                      {c.title}
                    </Link>
                  </td>
                  <td><StatusBadge value={c.status} /></td>
                  <td><SeverityBadge value={c.severity} /></td>
                  <td>
                    {c.slaRisk ? (
                      <span className="kelpie-badge text-amber-300">at risk</span>
                    ) : (
                      <span className="text-xs text-slate-500">clear</span>
                    )}
                  </td>
                  <td><TlpBadge value={c.tlp} /></td>
                  <td className="text-xs capitalize text-slate-300">
                    {c.classification.replace(/_/g, " ")}
                  </td>
                  <td>
                    <div className="flex max-w-64 flex-wrap gap-1">
                      {(Array.isArray(c.dataClassificationTags)
                        ? (c.dataClassificationTags as string[])
                        : []
                      ).map((tag) => (
                        <TagBadge key={`data-${tag}`} value={tag} tone="classification" />
                      ))}
                      {(Array.isArray(c.tags) ? (c.tags as string[]) : []).map((tag) => (
                        <TagBadge key={tag} value={tag} />
                      ))}
                    </div>
                  </td>
                  <td className="text-xs text-slate-300">
                    {c.queueName ?? <span className="text-slate-500">No queue</span>}
                  </td>
                  <td className="text-xs text-slate-300">
                    {c.assigneeName ?? <span className="text-slate-500">Unassigned</span>}
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-400">
                    {formatDistanceToNow(c.openedAt, { addSuffix: true })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Case pages">
          {page > 1 ? (
            <Link
              href={`/cases${queryString(params, { page: page - 1 })}`}
              className="kelpie-btn kelpie-btn-secondary"
            >
              Previous
            </Link>
          ) : <span />}
          {page < totalPages ? (
            <Link
              href={`/cases${queryString(params, { page: page + 1 })}`}
              className="kelpie-btn kelpie-btn-secondary"
            >
              Next
            </Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
  );
}

function QueueFilters({
  params,
  team,
  queueOptions,
  sourceOptions,
  activeFilters,
}: {
  params: QueueParams;
  team: TeamMember[];
  queueOptions: Array<{ id: string; name: string; teamName: string }>;
  sourceOptions: SourceOption[];
  activeFilters: number;
}) {
  return (
    <form className="kelpie-panel space-y-4 p-4" aria-label="Case filters">
      {params.view ? <input type="hidden" name="view" value={params.view} /> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs font-medium text-slate-300" htmlFor="case-search">
          Search
          <span className="relative mt-1 block">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              aria-hidden="true"
            />
            <input
              id="case-search"
              name="q"
              defaultValue={params.q}
              className="kelpie-input"
              style={{ paddingLeft: "2.5rem" }}
              placeholder="Case number or title"
            />
          </span>
        </label>
        <button className="kelpie-btn kelpie-btn-primary" type="submit">
          <Filter size={16} aria-hidden="true" />
          Apply filters
        </button>
        {activeFilters > 0 ? (
          <Link href="/cases" className="kelpie-btn kelpie-btn-ghost">
            <X size={16} aria-hidden="true" />
            Clear {activeFilters}
          </Link>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SelectFilter label="Status" name="status" value={params.status}>
          <option value="">Any status</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="Severity" name="severity" value={params.severity}>
          <option value="">Any severity</option>
          {SEVERITIES.map((value) => <option key={value}>{value}</option>)}
        </SelectFilter>
        <SelectFilter
          label="Classification"
          name="classification"
          value={params.classification}
        >
          <option value="">Any classification</option>
          {CLASSIFICATIONS.map((value) => (
            <option key={value} value={value}>{value.replace(/_/g, " ")}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="TLP" name="tlp" value={params.tlp}>
          <option value="">Any TLP</option>
          {TLPS.map((value) => (
            <option key={value} value={value}>{value.replace("_", "+")}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="Assignee" name="assignee" value={params.assignee}>
          <option value="">Anyone</option>
          <option value="mine">Mine</option>
          <option value="unassigned">Unassigned</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>{member.name}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="Queue" name="queueId" value={params.queueId}>
          <option value="">Any queue</option>
          <option value="none">No queue</option>
          {queueOptions.map((queue) => (
            <option key={queue.id} value={queue.id}>{queue.teamName} / {queue.name}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="Source" name="source" value={params.source}>
          <option value="">All sources</option>
          {sourceOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </SelectFilter>
        <SelectFilter label="SLA" name="sla" value={params.sla}>
          <option value="">Any SLA state</option>
          <option value="risk">At risk or breached</option>
        </SelectFilter>
        <SelectFilter label="Sort" name="sort" value={params.sort}>
          <option value="priority">Operational priority</option>
          <option value="recent">Newest opened</option>
          <option value="oldest">Oldest opened</option>
          <option value="severity">Severity</option>
        </SelectFilter>
        <SelectFilter label="ATT&CK tactic" name="tactic" value={params.tactic}>
          <option value="">Any tactic</option>
          {ATTACK_TACTICS.map((tactic) => (
            <option key={tactic.id} value={tactic.id}>{tactic.name}</option>
          ))}
        </SelectFilter>
        <TextFilter label="ATT&CK technique" name="technique" value={params.technique} />
        <div className="grid grid-cols-2 gap-3">
          <TextFilter label="Case tag" name="tag" value={params.tag} />
          <TextFilter
            label="Data tag"
            name="dataTag"
            value={params.dataTag}
          />
        </div>
      </div>
    </form>
  );
}

function SelectFilter({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs font-medium text-slate-300">
      {label}
      <select name={name} defaultValue={value ?? ""} className="kelpie-input mt-1 capitalize">
        {children}
      </select>
    </label>
  );
}

function TextFilter({
  label,
  name,
  value,
}: {
  label: string;
  name: string;
  value?: string;
}) {
  return (
    <label className="text-xs font-medium text-slate-300">
      {label}
      <input name={name} defaultValue={value} className="kelpie-input mt-1" />
    </label>
  );
}

function QueueMetric({
  label,
  value,
  hot,
}: {
  label: string;
  value: number;
  hot?: boolean;
}) {
  return (
    <div className="rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] p-3">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={
          "mt-1 text-2xl font-semibold tabular-nums " +
          (hot ? "text-[color:var(--color-sev-critical)]" : "text-slate-50")
        }
      >
        {value}
      </div>
    </div>
  );
}
