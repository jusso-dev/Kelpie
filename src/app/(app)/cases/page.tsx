import Link from "next/link";
import { and, asc, count, desc, eq, isNotNull, sql } from "drizzle-orm";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, Filter, Search, X } from "lucide-react";
import { db } from "@/db";
import { cases, queues, teamMembers, users } from "@/db/schema";
import { requireUser } from "@/lib/session";
import {
  caseKnowExistsSql,
  filterCasesForActor,
  resolveUserActor,
} from "@/lib/access";
import { caseSlaAtRiskSql } from "@/lib/sla";
import { listQueuesCore, listTeamsCore } from "@/lib/queues-core";
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
import { CaseViewSwitcher } from "@/components/case-view-switcher";
import { CaseViewWidgets } from "@/components/case-view-widgets";
import { CaseViewBulkPresets } from "@/components/case-view-bulk-presets";
import {
  CASE_VIEW_CLASSIFICATIONS,
  CASE_VIEW_COLUMNS,
  CASE_VIEW_OPERATIONAL_VIEWS,
  CASE_VIEW_PAGE_SIZES,
  CASE_VIEW_PRIORITY_BANDS,
  CASE_VIEW_SEVERITIES,
  CASE_VIEW_SORTS,
  CASE_VIEW_STATUSES,
  CASE_VIEW_TLPS,
  DEFAULT_CASE_VIEW_COLUMNS,
  type CaseViewColumn,
  type CaseViewConfig,
} from "@/lib/case-views/config";
import {
  configToUrlState,
  parseCaseListUrlState,
  serializeCaseListUrlState,
  urlStateMatchesConfig,
  urlStateToConfig,
  type CaseListUrlState,
} from "@/lib/case-views/url-state";
import { buildCaseFilterClauses } from "@/lib/case-views/filters";
import {
  computeCaseViewWidgetsCore,
  countManyCaseViewsCore,
  getCaseViewCore,
  listCaseViewDefaultsCore,
  listCaseViewsCore,
  resolveDefaultCaseViewCore,
  type CaseViewActor,
  type CaseViewRow,
} from "@/lib/case-views/core";

const VIEW_LABELS: Record<(typeof CASE_VIEW_OPERATIONAL_VIEWS)[number], string> = {
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

const COLUMN_LABELS: Record<CaseViewColumn, string> = {
  number: "Number",
  title: "Title",
  status: "Status",
  severity: "Severity",
  sla: "SLA",
  tlp: "TLP",
  classification: "Classification",
  tags: "Tags",
  queue: "Queue",
  assignee: "Assignee",
  opened: "Opened",
  priority: "Priority",
};

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;
type TeamMember = { id: string; name: string };
type SourceOption = { value: string; label: string };

function queryString(
  current: CaseListUrlState,
  updates: Partial<Record<keyof CaseListUrlState, string | number | undefined>> = {},
): string {
  return serializeCaseListUrlState(current, updates);
}

export default async function CasesPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const user = await requireUser();
  const accessActor = await resolveUserActor(user.organisationId, user.id);
  if (!accessActor) {
    throw new Error("Unable to resolve access actor for session user");
  }
  const actor: CaseViewActor = {
    id: user.id,
    organisationId: user.organisationId,
    role: user.role,
  };
  const canBulk = user.role === "admin" || user.role === "analyst";
  const canWriteViews = user.role === "admin" || user.role === "analyst";

  const [
    rawParams,
    team,
    sourceSystemRows,
    queueOptions,
    watchedCaseIds,
    savedViews,
    defaults,
    orgTeams,
    memberships,
  ] = await Promise.all([
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
    listCaseViewsCore(actor),
    listCaseViewDefaultsCore(actor),
    listTeamsCore(user.organisationId),
    db
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.organisationId, user.organisationId),
          eq(teamMembers.userId, user.id),
        ),
      ),
  ]);

  const memberTeamIds = new Set(memberships.map((m) => m.teamId));
  const personalDefaultId = defaults.find(
    (d) => d.scope === "personal" && d.userId === user.id,
  )?.viewId;

  // Parse URL first. Missing/inaccessible savedView falls back safely.
  let params = parseCaseListUrlState(rawParams);
  // Drop invalid assignee/queue references (team-scoped allow-list).
  if (
    params.assignee &&
    params.assignee !== "mine" &&
    params.assignee !== "unassigned" &&
    !team.some((m) => m.id === params.assignee)
  ) {
    params = { ...params, assignee: undefined };
  }
  if (
    params.queueId &&
    params.queueId !== "none" &&
    !queueOptions.some((q) => q.id === params.queueId)
  ) {
    params = { ...params, queueId: undefined };
  }
  if (
    params.tactic &&
    !ATTACK_TACTICS.some((t) => t.id === params.tactic)
  ) {
    params = { ...params, tactic: undefined };
  }

  let activeSavedView: CaseViewRow | null = null;

  const rawKeys = Object.keys(rawParams).filter((key) => {
    const value = rawParams[key];
    if (value === undefined || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  });
  const onlySavedViewKeys = rawKeys.every(
    (key) => key === "savedView" || key === "page",
  );
  const hasFilterParams = rawKeys.some(
    (key) => key !== "savedView" && key !== "page",
  );

  if (params.savedView) {
    activeSavedView = await getCaseViewCore(actor, params.savedView);
    if (!activeSavedView) {
      // Inaccessible / missing → standard list without savedView param.
      params = { ...params, savedView: undefined };
    } else if (onlySavedViewKeys) {
      // First load with only savedView=id: expand config into filter state.
      params = configToUrlState(activeSavedView.config, {
        savedViewId: activeSavedView.id,
        page: params.page,
      });
    }
    // Else: savedView + other params = dirty/shared unsaved set; keep URL filters.
  } else if (!hasFilterParams) {
    const defaultView = await resolveDefaultCaseViewCore(actor);
    if (defaultView) {
      activeSavedView = defaultView;
      params = configToUrlState(defaultView.config, {
        savedViewId: defaultView.id,
        page: 1,
      });
    }
  }

  const currentConfig: CaseViewConfig = urlStateToConfig(params);
  const isDirty = activeSavedView
    ? !urlStateMatchesConfig(params, activeSavedView.config)
    : false;

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

  const filterCtx = {
    organisationId: user.organisationId,
    userId: user.id,
    watchedCaseIds,
  };
  const filters = [
    ...buildCaseFilterClauses(currentConfig, filterCtx),
    // Compartment: drop cases the actor must not know exist (#61).
    caseKnowExistsSql(accessActor),
  ];
  const where = and(...filters);

  const pageSize = currentConfig.pageSize;
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
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(params.page, totalPages);
  params = { ...params, page };
  const slaRisk = caseSlaAtRiskSql();
  const severityRank = sql<number>`case ${cases.severity}
    when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`;
  const orderBy =
    currentConfig.sort === "oldest"
      ? [asc(cases.openedAt), asc(cases.id)]
      : currentConfig.sort === "recent"
        ? [desc(cases.openedAt), desc(cases.id)]
        : currentConfig.sort === "severity"
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
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Redact titles/summaries the actor can know exist but not fully view.
  const visibleRows = await filterCasesForActor(
    user.organisationId,
    accessActor,
    rows,
  );

  const columns: CaseViewColumn[] =
    currentConfig.columns.length > 0
      ? currentConfig.columns
      : [...DEFAULT_CASE_VIEW_COLUMNS];

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
    params.priorityBand,
    params.minPriorityScore,
  ].filter((v) => v !== undefined && v !== "").length;

  const firstResult = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResult = Math.min(page * pageSize, total);

  // Complete counts for switcher badges (bounded: first 20 views).
  const countByView = await countManyCaseViewsCore(
    actor,
    savedViews.slice(0, 20).map((v) => v.id),
    watchedCaseIds,
  );

  const widgetResults =
    activeSavedView && activeSavedView.config.widgets.length > 0
      ? await computeCaseViewWidgetsCore(
          filterCtx,
          // Widgets follow the *active list* filters (URL state), not only saved config,
          // so dirty edits still show consistent summaries.
          currentConfig,
          activeSavedView.config.widgets,
        )
      : [];

  const switcherViews = savedViews.map((view) => {
    const canWrite =
      user.role !== "read_only" &&
      (view.visibility === "organisation"
        ? user.role === "admin"
        : view.visibility === "personal"
          ? view.ownerUserId === user.id
          : user.role === "admin" ||
            (view.teamId != null && memberTeamIds.has(view.teamId)));
    return {
      id: view.id,
      name: view.name,
      visibility: view.visibility,
      teamId: view.teamId,
      count: countByView[view.id]?.total,
      isDefault: view.id === personalDefaultId,
      canWrite,
      href: `/cases${serializeCaseListUrlState(
        configToUrlState(view.config, { savedViewId: view.id }),
      )}`,
    };
  });

  const bulkPresets =
    activeSavedView && !isDirty ? activeSavedView.config.bulkPresets : [];

  const visibleTeams = orgTeams
    .filter((t) => t.isActive && (user.role === "admin" || memberTeamIds.has(t.id)))
    .map((t) => ({ id: t.id, name: t.name }));

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

      <CaseViewSwitcher
        views={switcherViews}
        activeViewId={activeSavedView?.id}
        isDirty={isDirty}
        currentConfig={currentConfig}
        teams={visibleTeams}
        canWrite={canWriteViews}
        isAdmin={user.role === "admin"}
      />

      {widgetResults.length > 0 ? (
        <CaseViewWidgets widgets={widgetResults} />
      ) : null}

      <nav aria-label="Built-in views" className="flex flex-wrap gap-2">
        {CASE_VIEW_OPERATIONAL_VIEWS.map((view) => (
          <Link
            key={view}
            href={`/cases${queryString(params, {
              view: params.view === view ? undefined : view,
              page: undefined,
            })}`}
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
        columns={columns}
      />

      {canBulk ? (
        <BulkActionsBar
          formId="bulk-case-form"
          queues={queueOptions}
          members={team}
        />
      ) : null}

      {canBulk && activeSavedView && bulkPresets.length > 0 ? (
        <CaseViewBulkPresets
          viewId={activeSavedView.id}
          formId="bulk-case-form"
          presets={bulkPresets}
        />
      ) : null}

      <div className="flex flex-col gap-2 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite">
          Showing {firstResult}-{lastResult} of {total} matching case
          {total === 1 ? "" : "s"}
        </p>
        <p>
          Page {page} of {totalPages}
        </p>
      </div>

      <div className="kelpie-panel kelpie-scroll-x" tabIndex={0} aria-label="Cases table">
        <table className="kelpie-table">
          <thead>
            <tr>
              {canBulk ? (
                <th>
                  <span className="sr-only">Select</span>
                </th>
              ) : null}
              {columns.map((col) => (
                <th key={col}>{COLUMN_LABELS[col]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={(canBulk ? 1 : 0) + columns.length}
                  className="py-10 text-center text-slate-400"
                >
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
              visibleRows.map((c) => (
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
                  {columns.map((col) => (
                    <td key={col}>
                      <CaseCell column={col} row={c} />
                    </td>
                  ))}
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
          ) : (
            <span />
          )}
          {page < totalPages ? (
            <Link
              href={`/cases${queryString(params, { page: page + 1 })}`}
              className="kelpie-btn kelpie-btn-secondary"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function CaseCell({
  column,
  row,
}: {
  column: CaseViewColumn;
  row: {
    caseNumber: string;
    id: string;
    title: string;
    status: string;
    severity: string;
    slaRisk: boolean | null;
    tlp: string;
    classification: string;
    tags: unknown;
    dataClassificationTags: unknown;
    queueName: string | null;
    assigneeName: string | null;
    openedAt: Date;
  };
}) {
  switch (column) {
    case "number":
      return <span className="font-mono text-xs text-slate-400">{row.caseNumber}</span>;
    case "title":
      return (
        <span className="max-w-sm block">
          <Link href={`/cases/${row.id}`} className="kelpie-link font-medium">
            {row.title}
          </Link>
        </span>
      );
    case "status":
      return <StatusBadge value={row.status as never} />;
    case "severity":
      return <SeverityBadge value={row.severity as never} />;
    case "sla":
      return row.slaRisk ? (
        <span className="kelpie-badge text-amber-300">at risk</span>
      ) : (
        <span className="text-xs text-slate-500">clear</span>
      );
    case "tlp":
      return <TlpBadge value={row.tlp as never} />;
    case "classification":
      return (
        <span className="text-xs capitalize text-slate-300">
          {row.classification.replace(/_/g, " ")}
        </span>
      );
    case "tags":
      return (
        <div className="flex max-w-64 flex-wrap gap-1">
          {(Array.isArray(row.dataClassificationTags)
            ? (row.dataClassificationTags as string[])
            : []
          ).map((tag) => (
            <TagBadge key={`data-${tag}`} value={tag} tone="classification" />
          ))}
          {(Array.isArray(row.tags) ? (row.tags as string[]) : []).map((tag) => (
            <TagBadge key={tag} value={tag} />
          ))}
        </div>
      );
    case "queue":
      return (
        <span className="text-xs text-slate-300">
          {row.queueName ?? <span className="text-slate-500">No queue</span>}
        </span>
      );
    case "assignee":
      return (
        <span className="text-xs text-slate-300">
          {row.assigneeName ?? <span className="text-slate-500">Unassigned</span>}
        </span>
      );
    case "opened":
      return (
        <span className="whitespace-nowrap text-xs text-slate-400">
          {formatDistanceToNow(row.openedAt, { addSuffix: true })}
        </span>
      );
    case "priority":
      // Priority score lives on a separate table; list shows severity proxy unless scored.
      return (
        <span className="text-xs capitalize text-slate-400">{row.severity}</span>
      );
    default:
      return null;
  }
}

function QueueFilters({
  params,
  team,
  queueOptions,
  sourceOptions,
  activeFilters,
  columns,
}: {
  params: CaseListUrlState;
  team: TeamMember[];
  queueOptions: Array<{ id: string; name: string; teamName: string }>;
  sourceOptions: SourceOption[];
  activeFilters: number;
  columns: CaseViewColumn[];
}) {
  return (
    <form className="kelpie-panel space-y-4 p-4" aria-label="Case filters">
      {params.view ? <input type="hidden" name="view" value={params.view} /> : null}
      {params.savedView ? (
        <input type="hidden" name="savedView" value={params.savedView} />
      ) : null}
      {columns.length > 0 ? (
        <input type="hidden" name="columns" value={columns.join(",")} />
      ) : null}
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
          {CASE_VIEW_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value.replace(/_/g, " ")}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="Severity" name="severity" value={params.severity}>
          <option value="">Any severity</option>
          {CASE_VIEW_SEVERITIES.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </SelectFilter>
        <SelectFilter
          label="Classification"
          name="classification"
          value={params.classification}
        >
          <option value="">Any classification</option>
          {CASE_VIEW_CLASSIFICATIONS.map((value) => (
            <option key={value} value={value}>
              {value.replace(/_/g, " ")}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="TLP" name="tlp" value={params.tlp}>
          <option value="">Any TLP</option>
          {CASE_VIEW_TLPS.map((value) => (
            <option key={value} value={value}>
              {value.replace("_", "+")}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="Assignee" name="assignee" value={params.assignee}>
          <option value="">Anyone</option>
          <option value="mine">Mine</option>
          <option value="unassigned">Unassigned</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="Queue" name="queueId" value={params.queueId}>
          <option value="">Any queue</option>
          <option value="none">No queue</option>
          {queueOptions.map((queue) => (
            <option key={queue.id} value={queue.id}>
              {queue.teamName} / {queue.name}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="Source" name="source" value={params.source}>
          <option value="">All sources</option>
          {sourceOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="SLA" name="sla" value={params.sla}>
          <option value="">Any SLA state</option>
          <option value="risk">At risk or breached</option>
        </SelectFilter>
        <SelectFilter label="Priority band" name="priorityBand" value={params.priorityBand}>
          <option value="">Any priority band</option>
          {CASE_VIEW_PRIORITY_BANDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="Sort" name="sort" value={params.sort}>
          {CASE_VIEW_SORTS.map((value) => (
            <option key={value} value={value}>
              {value === "priority"
                ? "Operational priority"
                : value === "recent"
                  ? "Newest opened"
                  : value === "oldest"
                    ? "Oldest opened"
                    : "Severity"}
            </option>
          ))}
        </SelectFilter>
        <SelectFilter
          label="Page size"
          name="pageSize"
          value={String(params.pageSize)}
        >
          {CASE_VIEW_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size} per page
            </option>
          ))}
        </SelectFilter>
        <SelectFilter label="ATT&CK tactic" name="tactic" value={params.tactic}>
          <option value="">Any tactic</option>
          {ATTACK_TACTICS.map((tactic) => (
            <option key={tactic.id} value={tactic.id}>
              {tactic.name}
            </option>
          ))}
        </SelectFilter>
        <TextFilter
          label="ATT&CK technique"
          name="technique"
          value={params.technique}
        />
        <div className="grid grid-cols-2 gap-3">
          <TextFilter label="Case tag" name="tag" value={params.tag} />
          <TextFilter label="Data tag" name="dataTag" value={params.dataTag} />
        </div>
        <p className="text-[10px] text-slate-500 sm:col-span-2 lg:col-span-4">
          Columns: {CASE_VIEW_COLUMNS.join(", ")}. Current: {columns.join(", ")}.
        </p>
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
