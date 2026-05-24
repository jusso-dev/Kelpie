import { db } from "@/db";
import { playbooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { togglePlaybookActive } from "@/actions/playbooks";

type Props = { params: Promise<{ id: string }> };

export default async function PlaybookDetailPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const [pb] = await db
    .select()
    .from(playbooks)
    .where(
      and(eq(playbooks.id, id), eq(playbooks.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!pb) notFound();

  const steps = Array.isArray(pb.steps)
    ? (pb.steps as Array<{
        id: string;
        title: string;
        description?: string;
        offsetMinutes: number;
        isRequired: boolean;
      }>)
    : [];

  async function toggle() {
    "use server";
    await togglePlaybookActive(id, !pb.isActive);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/playbooks" className="text-xs text-slate-400 hover:text-slate-200">
            ← Back to playbooks
          </Link>
          <h1 className="text-2xl font-semibold mt-1">{pb.name}</h1>
          <p className="text-sm text-slate-400 mt-1">{pb.description}</p>
          <p className="text-xs text-slate-500 mt-1 capitalize">
            Classification {pb.classification.replace(/_/g, " ")}
          </p>
        </div>
        <form action={toggle}>
          <button className="kelpie-btn kelpie-btn-secondary">
            {pb.isActive ? "Deactivate" : "Activate"}
          </button>
        </form>
      </div>

      <div className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-3">Steps</h2>
        {steps.length === 0 ? (
          <p className="text-sm text-slate-500">No steps defined.</p>
        ) : (
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={s.id ?? i} className="border-b border-[color:var(--color-navy-800)] pb-2">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-500 w-6">
                    {i + 1}
                  </span>
                  <span className="text-slate-100 font-medium">{s.title}</span>
                  <span className="text-xs text-slate-500 ml-auto">
                    due +{s.offsetMinutes}m
                  </span>
                  {!s.isRequired ? (
                    <span className="text-[10px] text-slate-500 uppercase">
                      optional
                    </span>
                  ) : null}
                </div>
                {s.description ? (
                  <p className="text-xs text-slate-400 mt-1 pl-9">{s.description}</p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
