import { db } from "@/db";
import { playbooks, type PlaybookContent, type PlaybookStep } from "@/db/schema";
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
import { ConfirmActionButton } from "@/components/confirm-dialog";
import { OBSERVABLE_TYPES } from "@/lib/observables-core";

type Props = { params: Promise<{ id: string }> };

const CONTENT_SECTIONS: Array<{ key: keyof PlaybookContent; label: string }> = [
  { key: "purpose", label: "Purpose" },
  { key: "triggers", label: "Triggers" },
  { key: "exclusions", label: "Exclusions" },
  { key: "severityGuidance", label: "Severity guidance" },
  { key: "evidenceToPreserve", label: "Evidence to preserve" },
  { key: "initialQuestions", label: "Initial questions" },
  { key: "decisionPoints", label: "Decision points" },
  { key: "approvalActions", label: "Actions requiring approval" },
  { key: "communicationsOwners", label: "Communications / escalation owners" },
  { key: "closureCriteria", label: "Closure criteria" },
  { key: "followUpImprovements", label: "Follow-up improvements" },
  { key: "mitreTechniques", label: "MITRE ATT&CK techniques" },
  { key: "caseFieldsToCapture", label: "Case fields to capture" },
];

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

  const steps = Array.isArray(pb.steps) ? (pb.steps as PlaybookStep[]) : [];
  const content: PlaybookContent =
    pb.content && typeof pb.content === "object" && !Array.isArray(pb.content)
      ? (pb.content as PlaybookContent)
      : {};
  const tags = Array.isArray(pb.tags) ? (pb.tags as string[]) : [];
  const requiredObservableTypes = Array.isArray(pb.requiredObservableTypes)
    ? (pb.requiredObservableTypes as string[])
    : [];
  const isBaseline = pb.catalogueKey !== null;

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
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <h1 className="text-2xl font-semibold">{pb.name}</h1>
            <span
              className={
                "kelpie-badge text-xs " +
                (isBaseline ? "text-[color:var(--color-tan-300)]" : "text-slate-400")
              }
            >
              {isBaseline ? `Baseline v${pb.catalogueVersion ?? 1}` : "Custom"}
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">{pb.description}</p>
          <p className="text-xs text-slate-500 mt-1 capitalize">
            Classification {pb.classification.replace(/_/g, " ")}
            {pb.defaultSeverity ? ` · Typical severity ${pb.defaultSeverity}` : ""}
          </p>
          {isBaseline ? (
            <p className="text-xs text-slate-500 mt-1">
              Baseline scenario key <code>{pb.catalogueKey}</code>. Editing and
              saving below only changes this organisation&rsquo;s copy — it
              will never be reverted by a catalogue sync.
            </p>
          ) : null}
        </div>
        <form action={toggle}>
          <button className="kelpie-btn kelpie-btn-secondary">
            {pb.isActive ? "Deactivate" : "Activate"}
          </button>
        </form>
      </div>

      {CONTENT_SECTIONS.some(({ key }) => {
        const value = content[key];
        return Array.isArray(value) ? value.length > 0 : Boolean(value);
      }) ? (
        <div className="kelpie-card p-5 space-y-4">
          <h2 className="text-sm font-medium text-slate-300">
            Operational detail
          </h2>
          {CONTENT_SECTIONS.map(({ key, label }) => {
            const value = content[key];
            if (!value || (Array.isArray(value) && value.length === 0)) return null;
            return (
              <div key={key}>
                <h3 className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  {label}
                </h3>
                {Array.isArray(value) ? (
                  <ul className="list-disc list-inside text-sm text-slate-300 space-y-0.5">
                    {value.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-300">{value}</p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

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
        <div className="grid gap-4 sm:grid-cols-2">
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
          <div>
            <label
              htmlFor="playbook-severity"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Typical severity
            </label>
            <select
              id="playbook-severity"
              name="defaultSeverity"
              className="kelpie-input"
              defaultValue={pb.defaultSeverity ?? ""}
            >
              <option value="">Not set</option>
              {["low", "medium", "high", "critical"].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label
            htmlFor="playbook-tags"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Tags
          </label>
          <input
            id="playbook-tags"
            name="tags"
            className="kelpie-input"
            placeholder="comma or newline separated"
            defaultValue={tags.join(", ")}
          />
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
            Required observable types
          </span>
          <div className="flex flex-wrap gap-3">
            {OBSERVABLE_TYPES.map((t) => (
              <label
                key={t}
                className="text-xs text-slate-300 inline-flex items-center gap-1"
              >
                <input
                  type="checkbox"
                  className="kelpie-checkbox"
                  name="requiredObservableTypes"
                  value={t}
                  defaultChecked={requiredObservableTypes.includes(t)}
                />
                {t.replace(/_/g, " ")}
              </label>
            ))}
          </div>
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

      <div className="flex justify-end">
        <ConfirmActionButton
          action={remove}
          title={`Delete playbook "${pb.name}"?`}
          description="Are you sure? This playbook and its steps are permanently removed. Existing case history remains intact."
          confirmLabel="Delete playbook"
          triggerLabel="Delete playbook"
          successTitle="Playbook deleted"
          successDescription="Existing case history was not changed."
          errorTitle="Playbook could not be deleted"
          redirectTo="/playbooks"
        />
      </div>
    </div>
  );
}
