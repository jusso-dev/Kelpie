import { db } from "@/db";
import { playbooks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import Link from "next/link";

export default async function PlaybooksPage() {
  const user = await requireUser();
  const rows = await db
    .select()
    .from(playbooks)
    .where(eq(playbooks.organisationId, user.organisationId))
    .orderBy(asc(playbooks.name));

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Playbooks</h1>
          <p className="text-sm text-slate-400">
            Define ordered steps with cadence offsets. Apply to a case to spawn
            its tasks with due times.
          </p>
        </div>
        <Link href="/playbooks/new" className="kelpie-btn kelpie-btn-primary">
          New playbook
        </Link>
      </header>

      <div className="kelpie-card overflow-hidden">
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
    </div>
  );
}
