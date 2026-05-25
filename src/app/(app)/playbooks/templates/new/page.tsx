import { db } from "@/db";
import { playbooks } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { createCaseTemplate } from "@/actions/case-templates";
import TemplateTasksEditor from "@/components/template-tasks-editor";

export default async function NewTemplatePage() {
  const user = await requireRole(["admin"]);
  const playbookOptions = await db
    .select({ id: playbooks.id, name: playbooks.name })
    .from(playbooks)
    .where(eq(playbooks.organisationId, user.organisationId))
    .orderBy(asc(playbooks.name));

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">New case template</h1>
      <p className="text-sm text-slate-400 mb-5">
        A template prefills the next case in one click. The summary template
        can use <code>{`{{date}}`}</code>, <code>{`{{reporter}}`}</code>,{" "}
        <code>{`{{organisation}}`}</code>.
      </p>
      <form action={createCaseTemplate} className="kelpie-card p-6 space-y-4">
        <div>
          <label
            htmlFor="template-name"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Name
          </label>
          <input id="template-name" name="name" className="kelpie-input" required />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Classification"
            name="classification"
            options={[
              "malware",
              "phishing",
              "unauthorised_access",
              "data_breach",
              "dos",
              "policy_violation",
              "other",
            ]}
            defaultValue="phishing"
          />
          <Select
            label="Default severity"
            name="severity"
            options={["low", "medium", "high", "critical"]}
            defaultValue="medium"
          />
          <Select
            label="Default TLP"
            name="tlp"
            options={["clear", "green", "amber", "amber_strict", "red"]}
            defaultValue="amber"
          />
          <div>
            <label
              htmlFor="template-default-playbook"
              className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
            >
              Default playbook (optional)
            </label>
            <select id="template-default-playbook" name="defaultPlaybookId" className="kelpie-input" defaultValue="">
              <option value="">None</option>
              {playbookOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label
            htmlFor="template-summary"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Summary template (markdown)
          </label>
          <textarea
            id="template-summary"
            name="summaryTemplate"
            className="kelpie-input"
            rows={5}
            placeholder={"Reported on {{date}} by {{reporter}}. ..."}
          />
        </div>
        <TemplateTasksEditor />
        <div className="flex justify-end">
          <button className="kelpie-btn kelpie-btn-primary">Create template</button>
        </div>
      </form>
    </div>
  );
}

function Select({
  label,
  name,
  options,
  defaultValue,
}: {
  label: string;
  name: string;
  options: string[];
  defaultValue: string;
}) {
  return (
    <div>
      <label
        htmlFor={`template-${name}`}
        className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
      >
        {label}
      </label>
      <select id={`template-${name}`} name={name} className="kelpie-input" defaultValue={defaultValue}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}
