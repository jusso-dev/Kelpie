import Link from "next/link";
import {
  and,
  asc,
  count,
  eq,
  isNull,
  sql,
} from "drizzle-orm";
import { AlertTriangle, CheckCircle2, Filter, ListChecks, X } from "lucide-react";
import { db } from "@/db";
import { cases, caseTasks, users } from "@/db/schema";
import { requireUser } from "@/lib/session";
import TaskInboxRow from "@/components/task-inbox-row";

const PAGE_SIZE = 50;
const STATUSES = ["open", "todo", "in_progress", "blocked", "done", "all"] as const;
const DUE_STATES = ["any", "overdue", "soon", "later", "none"] as const;

type TeamMember = { id: string; name: string };
type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;
type InboxParams = {
  status: (typeof STATUSES)[number];
  due: (typeof DUE_STATES)[number];
  assignee?: string;
  page: number;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pick<const T extends readonly string[]>(
  values: T,
  value: string | undefined,
): T[number] | undefined {
  return value && (values as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function normaliseParams(
  raw: Record<string, string | string[] | undefined>,
  team: TeamMember[],
): InboxParams {
  const rawAssignee = first(raw.assignee);
  const assignee =
    rawAssignee === "mine" || rawAssignee === "unassigned"
      ? rawAssignee
      : team.some((member) => member.id === rawAssignee)
        ? rawAssignee
        : undefined;
  const rawPage = Number(first(raw.page));
  return {
    status: pick(STATUSES, first(raw.status)) ?? "open",
    due: pick(DUE_STATES, first(raw.due)) ?? "any",
    assignee,
    page:
      Number.isInteger(rawPage) && rawPage > 0
        ? Math.min(rawPage, 10_000)
        : 1,
  };
}

function queryString(
  current: InboxParams,
  updates: Partial<Record<keyof InboxParams, string | number | undefined>>,
): string {
  const merged = { ...current, ...updates };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (
      value !== undefined &&
      value !== "" &&
      !(key === "status" && value === "open") &&
      !(key === "due" && value === "any") &&
      !(key === "page" && value === 1)
    ) {
      query.set(key, String(value));
    }
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const user = await requireUser();
  const [rawParams, team] = await Promise.all([
    searchParams,
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, user.organisationId))
      .orderBy(asc(users.name)),
  ]);
  const params = normaliseParams(rawParams, team);
  const filters = [eq(cases.organisationId, user.organisationId)];

  if (params.status === "open") {
    filters.push(sql`${caseTasks.status} <> 'done'`);
  } else if (params.status !== "all") {
    filters.push(eq(caseTasks.status, params.status));
  }
  if (params.assignee === "mine") {
    filters.push(eq(caseTasks.assigneeId, user.id));
  } else if (params.assignee === "unassigned") {
    filters.push(isNull(caseTasks.assigneeId));
  } else if (params.assignee) {
    filters.push(eq(caseTasks.assigneeId, params.assignee));
  }
  if (params.due === "overdue") {
    filters.push(sql`${caseTasks.status} <> 'done' and ${caseTasks.dueAt} < now()`);
  } else if (params.due === "soon") {
    filters.push(
      sql`${caseTasks.status} <> 'done' and ${caseTasks.dueAt} >= now() and ${caseTasks.dueAt} <= now() + interval '24 hours'`,
    );
  } else if (params.due === "later") {
    filters.push(
      sql`${caseTasks.status} <> 'done' and ${caseTasks.dueAt} > now() + interval '24 hours'`,
    );
  } else if (params.due === "none") {
    filters.push(isNull(caseTasks.dueAt));
  }

  const where = and(...filters);
  const [metrics] = await db
    .select({
      total: count(),
      open: sql<number>`count(*) filter (where ${caseTasks.status} <> 'done')`,
      mine: sql<number>`count(*) filter (where ${caseTasks.status} <> 'done' and ${caseTasks.assigneeId} = ${user.id})`,
      overdue: sql<number>`count(*) filter (where ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} < now())`,
      soon: sql<number>`count(*) filter (where ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} >= now() and ${caseTasks.dueAt} <= now() + interval '24 hours')`,
    })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(eq(cases.organisationId, user.organisationId));

  const [filtered] = await db
    .select({ total: count() })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(where);
  const total = Number(filtered?.total ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(params.page, totalPages);
  params.page = page;

  const dueRank = sql<number>`case
    when ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} < now() then 0
    when ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} <= now() + interval '24 hours' then 1
    when ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} is not null then 2
    when ${caseTasks.status} <> 'done' then 3
    else 4 end`;
  const dueState = sql<"overdue" | "soon" | "later" | "none" | "done">`case
    when ${caseTasks.status} = 'done' then 'done'
    when ${caseTasks.dueAt} < now() then 'overdue'
    when ${caseTasks.dueAt} <= now() + interval '24 hours' then 'soon'
    when ${caseTasks.dueAt} is not null then 'later'
    else 'none' end`;

  const rows = await db
    .select({
      id: caseTasks.id,
      title: caseTasks.title,
      description: caseTasks.description,
      status: caseTasks.status,
      dueAt: caseTasks.dueAt,
      dueState,
      assigneeName: users.name,
      caseId: cases.id,
      caseNumber: cases.caseNumber,
      caseTitle: cases.title,
      caseSeverity: cases.severity,
    })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .leftJoin(users, eq(users.id, caseTasks.assigneeId))
    .where(where)
    .orderBy(
      asc(dueRank),
      sql`${caseTasks.dueAt} asc nulls last`,
      asc(cases.caseNumber),
      asc(caseTasks.orderIndex),
      asc(caseTasks.id),
    )
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const activeFilters =
    Number(params.status !== "open") +
    Number(params.due !== "any") +
    Number(Boolean(params.assignee));
  const canEdit = user.role === "admin" || user.role === "analyst";
  const firstResult = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[color:var(--color-tan-300)]">
            <ListChecks size={15} aria-hidden="true" />
            Task inbox
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-50">
            Work that needs attention across every case
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Overdue work rises first, followed by tasks due in the next 24 hours.
          </p>
        </div>
        <Link href="/cases" className="kelpie-btn kelpie-btn-secondary">
          View case queue
        </Link>
      </header>

      <section className="kelpie-panel flex flex-wrap divide-y divide-[color:var(--color-navy-700)] p-1 sm:divide-x sm:divide-y-0" aria-label="Task summary">
        <Summary label="Open" value={Number(metrics?.open ?? 0)} />
        <Summary label="Mine" value={Number(metrics?.mine ?? 0)} />
        <Summary label="Overdue" value={Number(metrics?.overdue ?? 0)} urgent />
        <Summary label="Due in 24h" value={Number(metrics?.soon ?? 0)} />
      </section>

      <form className="kelpie-panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto_auto] lg:items-end" aria-label="Task filters">
        <SelectFilter label="Status" name="status" value={params.status}>
          <option value="open">Open tasks</option>
          <option value="todo">To do</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="done">Done</option>
          <option value="all">All statuses</option>
        </SelectFilter>
        <SelectFilter label="Due" name="due" value={params.due}>
          <option value="any">Any due state</option>
          <option value="overdue">Overdue</option>
          <option value="soon">Due in 24 hours</option>
          <option value="later">Due later</option>
          <option value="none">No due date</option>
        </SelectFilter>
        <SelectFilter label="Assignee" name="assignee" value={params.assignee}>
          <option value="">Anyone</option>
          <option value="mine">Mine</option>
          <option value="unassigned">Unassigned</option>
          {team.map((member) => (
            <option key={member.id} value={member.id}>{member.name}</option>
          ))}
        </SelectFilter>
        <button className="kelpie-btn kelpie-btn-primary" type="submit">
          <Filter size={16} aria-hidden="true" />
          Apply
        </button>
        {activeFilters > 0 ? (
          <Link href="/tasks" className="kelpie-btn kelpie-btn-ghost">
            <X size={16} aria-hidden="true" />
            Clear
          </Link>
        ) : null}
      </form>

      <div className="flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite">
          Showing {firstResult}-{lastResult} of {total} matching task{total === 1 ? "" : "s"}
        </p>
        {total > 0 ? <p>Page {page} of {totalPages}</p> : null}
      </div>

      {rows.length > 0 ? (
        <div className="space-y-3">
          {rows.map((task) => (
            <TaskInboxRow key={task.id} task={task} canEdit={canEdit} />
          ))}
        </div>
      ) : (
        <div className="kelpie-card px-5 py-12 text-center">
          {Number(metrics?.total ?? 0) === 0 ? (
            <>
              <CheckCircle2 className="mx-auto text-green-400" size={28} aria-hidden="true" />
              <h2 className="mt-3 font-medium text-slate-100">No task work yet</h2>
              <p className="mt-1 text-sm text-slate-400">
                Tasks added to cases and playbooks will appear here.
              </p>
              <Link href="/cases" className="kelpie-link mt-3 inline-block">Open a case</Link>
            </>
          ) : Number(metrics?.open ?? 0) === 0 && activeFilters === 0 ? (
            <>
              <CheckCircle2 className="mx-auto text-green-400" size={28} aria-hidden="true" />
              <h2 className="mt-3 font-medium text-slate-100">All open work is complete</h2>
              <p className="mt-1 text-sm text-slate-400">There are no outstanding tasks across your cases.</p>
              <Link href="/tasks?status=done" className="kelpie-link mt-3 inline-block">Review completed tasks</Link>
            </>
          ) : (
            <>
              <AlertTriangle className="mx-auto text-slate-500" size={28} aria-hidden="true" />
              <h2 className="mt-3 font-medium text-slate-100">No tasks match these filters</h2>
              <p className="mt-1 text-sm text-slate-400">Change or clear the filters to see other work.</p>
              <Link href="/tasks" className="kelpie-link mt-3 inline-block">Clear filters</Link>
            </>
          )}
        </div>
      )}

      {totalPages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label="Task pages">
          {page > 1 ? (
            <Link href={`/tasks${queryString(params, { page: page - 1 })}`} className="kelpie-btn kelpie-btn-secondary">Previous</Link>
          ) : <span />}
          {page < totalPages ? (
            <Link href={`/tasks${queryString(params, { page: page + 1 })}`} className="kelpie-btn kelpie-btn-secondary">Next</Link>
          ) : <span />}
        </nav>
      ) : null}
    </div>
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

function Summary({ label, value, urgent }: { label: string; value: number; urgent?: boolean }) {
  return (
    <div className="min-w-[50%] flex-1 px-4 py-3 sm:min-w-0">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${urgent && value > 0 ? "text-red-300" : "text-slate-100"}`}>
        {value}
      </p>
    </div>
  );
}
