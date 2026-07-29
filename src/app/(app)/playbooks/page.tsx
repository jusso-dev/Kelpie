import { db } from "@/db";
import { caseTemplates } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { deleteCaseTemplate } from "@/actions/case-templates";
import { ConfirmFormActionButton } from "@/components/confirm-dialog";
import SyncCatalogueButton from "@/components/sync-catalogue-button";
import { listPlaybooksCore } from "@/lib/playbooks-core";
import { BASELINE_PLAYBOOKS } from "@/lib/playbook-catalogue";
import { OBSERVABLE_TYPES } from "@/lib/observables-core";
import Link from "next/link";
import PageExplainer from "@/components/page-explainer";

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

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(raw: string | string[] | undefined): string | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value?.trim() || undefined;
}

export default async function PlaybooksPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter = {
    scenario: first(sp.scenario),
    classification: first(sp.classification),
    severity: first(sp.severity),
    tag: first(sp.tag),
    observableType: first(sp.observableType),
    q: first(sp.q),
    includeInactive: first(sp.includeInactive) === "true",
  };
  const hasFilter = Object.values(filter).some((v) => v !== undefined && v !== false);

  const [rows, templates] = await Promise.all([
    listPlaybooksCore(user.organisationId, filter),
    db
      .select()
      .from(caseTemplates)
      .where(eq(caseTemplates.organisationId, user.organisationId))
      .orderBy(asc(caseTemplates.name)),
  ]);
  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Playbooks & templates</h1>
          <PageExplainer page="playbooks" />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {isAdmin ? <SyncCatalogueButton /> : null}
          {isAdmin ? (
            <Link
              href="/playbooks/templates/new"
              className="kelpie-btn kelpie-btn-secondary"
            >
              New template
            </Link>
          ) : null}
          <Link href="/playbooks/new" className="kelpie-btn kelpie-btn-primary">
            New playbook
          </Link>
        </div>
      </header>

      <form
        method="get"
        className="kelpie-card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6"
        aria-label="Filter playbooks"
      >
        <div className="lg:col-span-2">
          <label htmlFor="pb-filter-q" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Search
          </label>
          <input
            id="pb-filter-q"
            name="q"
            className="kelpie-input"
            placeholder="Name or description"
            defaultValue={filter.q ?? ""}
          />
        </div>
        <div>
          <label htmlFor="pb-filter-scenario" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Scenario
          </label>
          <select
            id="pb-filter-scenario"
            name="scenario"
            className="kelpie-input"
            defaultValue={filter.scenario ?? ""}
          >
            <option value="">All scenarios</option>
            {BASELINE_PLAYBOOKS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pb-filter-classification" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Classification
          </label>
          <select
            id="pb-filter-classification"
            name="classification"
            className="kelpie-input"
            defaultValue={filter.classification ?? ""}
          >
            <option value="">All classifications</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pb-filter-severity" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Severity
          </label>
          <select
            id="pb-filter-severity"
            name="severity"
            className="kelpie-input"
            defaultValue={filter.severity ?? ""}
          >
            <option value="">Any severity</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pb-filter-observable" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Required observable
          </label>
          <select
            id="pb-filter-observable"
            name="observableType"
            className="kelpie-input"
            defaultValue={filter.observableType ?? ""}
          >
            <option value="">Any type</option>
            {OBSERVABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pb-filter-tag" className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Tag
          </label>
          <input
            id="pb-filter-tag"
            name="tag"
            className="kelpie-input"
            placeholder="e.g. endpoint"
            defaultValue={filter.tag ?? ""}
          />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="kelpie-btn kelpie-btn-primary">
            Apply filters
          </button>
          {hasFilter ? (
            <Link href="/playbooks" className="kelpie-btn kelpie-btn-ghost text-sm">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <div className="kelpie-card kelpie-scroll-x" tabIndex={0} aria-label="Playbooks table">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Classification</th>
              <th>Severity</th>
              <th>Provenance</th>
              <th>Steps</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-slate-500 py-8">
                  {hasFilter
                    ? "No playbooks match these filters."
                    : "No playbooks yet."}
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link
                      href={`/playbooks/${p.id}`}
                      className="kelpie-link font-medium"
                    >
                      {p.name}
                    </Link>
                    {p.description ? (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {p.description}
                      </div>
                    ) : null}
                    {p.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {p.tags.map((tag) => (
                          <span
                            key={tag}
                            className="kelpie-badge text-[10px] text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="text-slate-300 text-xs capitalize">
                    {p.classification.replace(/_/g, " ")}
                  </td>
                  <td className="text-slate-300 text-xs capitalize">
                    {p.defaultSeverity ?? "—"}
                  </td>
                  <td>
                    <span
                      className={
                        "kelpie-badge text-xs " +
                        (p.isBaseline ? "text-[color:var(--color-tan-300)]" : "text-slate-400")
                      }
                      title={
                        p.isBaseline
                          ? `Baseline catalogue v${p.catalogueVersion ?? 1} (${p.catalogueKey})`
                          : "Custom playbook authored by your team"
                      }
                    >
                      {p.isBaseline ? `Baseline v${p.catalogueVersion ?? 1}` : "Custom"}
                    </span>
                  </td>
                  <td className="text-slate-300 tabular-nums">{p.stepCount}</td>
                  <td>
                    <span
                      className={
                        "kelpie-badge " +
                        (p.isActive ? "text-green-400" : "text-slate-500")
                      }
                    >
                      {p.isActive ? "active" : "inactive"}
                    </span>
                  </td>
                  <td className="text-right">
                    <Link href={`/playbooks/${p.id}`} className="kelpie-link text-sm">
                      Edit →
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="kelpie-card kelpie-scroll-x" tabIndex={0} aria-label="Case templates table">
        <div className="px-4 py-3 border-b border-[color:var(--color-navy-700)]">
          <h2 className="text-sm font-medium text-slate-300">Case templates</h2>
        </div>
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Classification</th>
              <th>Default severity</th>
              <th>TLP</th>
              <th>Provenance</th>
              <th>Default tasks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-slate-500 py-8">
                  No case templates yet.
                </td>
              </tr>
            ) : (
              templates.map((t) => {
                const tasks = Array.isArray(t.defaultTasks)
                  ? (t.defaultTasks as unknown[])
                  : [];
                return (
                  <tr key={t.id}>
                    <td className="font-medium">{t.name}</td>
                    <td className="text-slate-300 text-xs capitalize">
                      {t.classification.replace(/_/g, " ")}
                    </td>
                    <td className="text-slate-300 text-xs">
                      {t.defaultSeverity}
                    </td>
                    <td className="text-slate-300 text-xs">
                      {t.defaultTlp.replace("_", "+")}
                    </td>
                    <td>
                      <span
                        className={
                          "kelpie-badge text-xs " +
                          (t.catalogueKey ? "text-[color:var(--color-tan-300)]" : "text-slate-400")
                        }
                      >
                        {t.catalogueKey ? "Baseline" : "Custom"}
                      </span>
                    </td>
                    <td className="tabular-nums text-slate-400">{tasks.length}</td>
                    <td className="text-right">
                      {isAdmin ? (
                        <ConfirmFormActionButton
                          action={deleteCaseTemplate}
                          values={{ id: t.id }}
                          title={`Delete template "${t.name}"?`}
                          description="Are you sure? This template is permanently removed. Cases already created from it remain unchanged."
                          confirmLabel="Delete template"
                          triggerLabel="Delete"
                          successTitle="Template deleted"
                          successDescription="Existing cases were not changed."
                          errorTitle="Template could not be deleted"
                          className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs"
                        />
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
