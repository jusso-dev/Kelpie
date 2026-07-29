import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  getCaseTemplateCoverage,
  getOrgCoverageStats,
  getPlaybookCoverage,
} from "@/lib/attack/coverage-core";
import { ensureCatalogInitialised, listCatalogVersions } from "@/lib/attack/catalog-core";
import { PLAYBOOK_GUIDANCE_CATEGORIES } from "@/lib/attack/playbook-guidance";
import { listD3fendMappingsCore } from "@/lib/attack/d3fend-core";
import AttackCatalogAdminPanel from "@/components/attack-catalog-admin-panel";
import PageExplainer from "@/components/page-explainer";

export default async function AttackCoveragePage() {
  const user = await requireUser();
  await ensureCatalogInitialised();

  const [stats, playbookCoverage, templateCoverage, versions, d3fendMappings] = await Promise.all([
    getOrgCoverageStats(user.organisationId),
    getPlaybookCoverage(user.organisationId),
    getCaseTemplateCoverage(user.organisationId),
    user.role === "admin" ? listCatalogVersions() : Promise.resolve([]),
    listD3fendMappingsCore(user.organisationId),
  ]);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">ATT&CK coverage</h1>
        <PageExplainer page="attack-coverage" className="mt-1" />
      </header>

      {user.role === "admin" ? (
        <AttackCatalogAdminPanel
          versions={versions.map((v) => ({
            id: v.id,
            version: v.version,
            source: v.source,
            status: v.status,
            techniqueCount: v.techniqueCount,
            tacticCount: v.tacticCount,
            error: v.error,
            importedAt: v.importedAt.toISOString(),
            activatedAt: v.activatedAt ? v.activatedAt.toISOString() : null,
          }))}
        />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="kelpie-card p-5 space-y-3">
          <h2 className="text-sm font-medium text-slate-300">Mapped techniques by tactic</h2>
          {stats.byTactic.length === 0 ? (
            <p className="text-xs text-slate-500">
              No techniques mapped yet. Attach a technique from a case to see coverage here.
            </p>
          ) : (
            <ul className="space-y-1">
              {stats.byTactic.map((t) => (
                <li key={t.tacticId} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{t.tacticName}</span>
                  <span className="kelpie-badge">{t.mappedTechniqueCount}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-slate-500 pt-2 border-t border-[color:var(--color-navy-700)]">
            {stats.totalMappedTechniques} distinct technique{stats.totalMappedTechniques === 1 ? "" : "s"} mapped
            across {stats.totalMappings} mapping{stats.totalMappings === 1 ? "" : "s"}.
          </p>
        </div>

        <div className="kelpie-card p-5 space-y-3">
          <h2 className="text-sm font-medium text-slate-300">Unresolved work</h2>
          <p className="text-xs text-slate-500">
            Mappings missing both detection notes and response notes ({stats.unresolvedCount}).
          </p>
          {stats.unresolvedMappings.length === 0 ? (
            <p className="text-xs text-slate-500">Nothing unresolved.</p>
          ) : (
            <ul className="space-y-1">
              {stats.unresolvedMappings.map((m) => (
                <li key={m.id} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-400">{m.techniqueId}</span>
                  <span className="text-slate-500">{m.entityType}</span>
                  {m.caseId ? (
                    <Link href={`/cases/${m.caseId}`} className="kelpie-link">
                      View case
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="kelpie-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Playbook coverage gaps</h2>
        <p className="text-xs text-slate-500">
          For each active playbook, mapped techniques this org has encountered that are not
          documented by any step, broken down by guidance category.
        </p>
        {playbookCoverage.length === 0 ? (
          <p className="text-xs text-slate-500">No active playbooks.</p>
        ) : (
          <CoverageTable
            rows={playbookCoverage.map((p) => ({ id: p.playbookId, name: p.playbookName, gaps: p.gaps }))}
            emptyLabel="documents everything mapped"
          />
        )}
      </div>

      <div className="kelpie-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">Case template coverage gaps</h2>
        {templateCoverage.length === 0 ? (
          <p className="text-xs text-slate-500">No case templates configured.</p>
        ) : (
          <CoverageTable
            rows={templateCoverage.map((t) => ({ id: t.templateId, name: t.templateName, gaps: t.gaps }))}
            emptyLabel="documents everything mapped"
          />
        )}
      </div>

      <div className="kelpie-card p-5 space-y-3">
        <h2 className="text-sm font-medium text-slate-300">D3FEND countermeasure mappings</h2>
        <p className="text-xs text-slate-500">
          Optional, versioned D3FEND countermeasure links to playbook steps and response
          actions. Manage these via the REST API or MCP (<code>/api/v1/attack/d3fend-mappings</code>);
          administrator/analyst curated, never inferred automatically.
        </p>
        {d3fendMappings.length === 0 ? (
          <p className="text-xs text-slate-500">No D3FEND mappings configured yet.</p>
        ) : (
          <ul className="space-y-1">
            {d3fendMappings.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span>
                  <span className="font-mono text-slate-400">{m.d3fendTechniqueId}</span>{" "}
                  {m.d3fendTechniqueName}
                </span>
                <span className="text-slate-500">catalog {m.catalogVersion}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CoverageTable({
  rows,
  emptyLabel,
}: {
  rows: Array<{ id: string; name: string; gaps: Record<string, string[]> }>;
  emptyLabel: string;
}) {
  return (
    <div className="kelpie-scroll-x">
      <table className="kelpie-table">
        <thead>
          <tr>
            <th>Name</th>
            {PLAYBOOK_GUIDANCE_CATEGORIES.map((category) => (
              <th key={category} className="capitalize">
                {category}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              {PLAYBOOK_GUIDANCE_CATEGORIES.map((category) => {
                const gaps = row.gaps[category] ?? [];
                return (
                  <td key={category} className="text-xs">
                    {gaps.length === 0 ? (
                      <span className="text-slate-500">{emptyLabel}</span>
                    ) : (
                      <span className="text-amber-300">{gaps.length} gap{gaps.length === 1 ? "" : "s"}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
