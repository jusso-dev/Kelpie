import { db } from "@/db";
import { caseTemplates, playbooks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { deleteCaseTemplate } from "@/actions/case-templates";
import Link from "next/link";

export default async function PlaybooksPage() {
  const user = await requireUser();
  const [rows, templates] = await Promise.all([
    db
      .select()
      .from(playbooks)
      .where(eq(playbooks.organisationId, user.organisationId))
      .orderBy(asc(playbooks.name)),
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
          <p className="text-sm text-slate-400">
            Playbooks define ordered steps with cadence offsets. Templates
            prefill a new case in one click.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
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

      <div className="kelpie-card kelpie-scroll-x" tabIndex={0} aria-label="Playbooks table">
        <table className="kelpie-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Classification</th>
              <th>Steps</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-slate-500 py-8">
                  No playbooks yet.
                </td>
              </tr>
            ) : (
              rows.map((p) => {
                const steps = Array.isArray(p.steps) ? (p.steps as unknown[]) : [];
                return (
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
                    </td>
                    <td className="text-slate-300 text-xs capitalize">
                      {p.classification.replace(/_/g, " ")}
                    </td>
                    <td className="text-slate-300 tabular-nums">{steps.length}</td>
                    <td>
                      <span
                        className={
                          "kelpie-badge " +
                          (p.isActive
                            ? "text-green-400"
                            : "text-slate-500")
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
                );
              })
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
              <th>Default tasks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-slate-500 py-8">
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
                    <td className="tabular-nums text-slate-400">{tasks.length}</td>
                    <td className="text-right">
                      {isAdmin ? (
                        <form
                          action={async (fd) => {
                            "use server";
                            fd.set("id", t.id);
                            await deleteCaseTemplate(fd);
                          }}
                          className="inline"
                        >
                          <button className="kelpie-btn kelpie-btn-ghost text-red-400 text-xs">
                            Delete
                          </button>
                        </form>
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
