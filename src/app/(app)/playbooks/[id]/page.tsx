import { db } from "@/db";
import { playbooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import {
  deletePlaybook,
  togglePlaybookActive,
  updatePlaybook,
} from "@/actions/playbooks";
import PlaybookStepsEditor from "@/components/playbook-steps-editor";

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

  async function update(formData: FormData) {
    "use server";
    await updatePlaybook(id, formData);
  }

  async function remove() {
    "use server";
    await deletePlaybook(id);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
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

      <form action={update} className="kelpie-card p-5 space-y-4">
        <h2 className="text-sm font-medium text-slate-300">Edit playbook</h2>
        <div>
          <label
            htmlFor="playbook-name"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Name
          </label>
          <input
            id="playbook-name"
            name="name"
            className="kelpie-input"
            defaultValue={pb.name}
            required
          />
        </div>
        <div>
          <label
            htmlFor="playbook-description"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Description
          </label>
          <textarea
            id="playbook-description"
            name="description"
            className="kelpie-input"
            rows={3}
            defaultValue={pb.description ?? ""}
          />
        </div>
        <div>
          <label
            htmlFor="playbook-classification"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Classification
          </label>
          <select
            id="playbook-classification"
            name="classification"
            className="kelpie-input"
            defaultValue={pb.classification}
          >
            {[
              "malware",
              "phishing",
              "unauthorised_access",
              "data_breach",
              "dos",
              "policy_violation",
              "other",
            ].map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <PlaybookStepsEditor
          initial={steps.map((s) => ({
            title: s.title,
            description: s.description ?? "",
            offsetMinutes: s.offsetMinutes,
            isRequired: s.isRequired,
          }))}
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button className="kelpie-btn kelpie-btn-primary">Save changes</button>
        </div>
      </form>

      <form action={remove} className="flex justify-end">
        <button className="kelpie-btn kelpie-btn-ghost text-red-400">
          Delete playbook
        </button>
      </form>
    </div>
  );
}
