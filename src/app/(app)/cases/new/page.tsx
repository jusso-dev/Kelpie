import { db } from "@/db";
import { caseTemplates } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { createCase } from "@/actions/cases";
import { applyCaseTemplate } from "@/actions/case-templates";

export default async function NewCasePage() {
  const user = await requireUser();
  const templates = await db
    .select({
      id: caseTemplates.id,
      name: caseTemplates.name,
      classification: caseTemplates.classification,
    })
    .from(caseTemplates)
    .where(eq(caseTemplates.organisationId, user.organisationId))
    .orderBy(asc(caseTemplates.name));

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold mb-1">Open a new case</h1>
        <p className="text-sm text-slate-400">
          A case number is generated automatically per organisation.
        </p>
      </header>

      {templates.length > 0 ? (
        <form action={applyCaseTemplate} className="kelpie-card p-5 space-y-3">
          <h2 className="text-sm font-medium text-slate-300">
            Start from a template
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              <label
                htmlFor="template-id"
                className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
              >
                Template
              </label>
              <select id="template-id" name="templateId" className="kelpie-input" defaultValue={templates[0].id}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — {t.classification.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="template-title"
                className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
              >
                Title override (optional)
              </label>
              <input id="template-title" name="title" className="kelpie-input" placeholder="(uses template name)" />
            </div>
          </div>
          <div className="flex justify-end">
            <button className="kelpie-btn kelpie-btn-primary">
              Open case from template
            </button>
          </div>
        </form>
      ) : null}

      <form action={createCase} className="kelpie-card p-6 space-y-4">
        <h2 className="text-sm font-medium text-slate-300">Or fill in by hand</h2>
        <Field label="Title" name="title" required />
        <Field
          label="Summary"
          name="summary"
          as="textarea"
          rows={4}
          help="What is happening? Stick to facts; the analyst can add detail later."
        />
        <Field
          label="Tags"
          name="tags"
          help="Comma-separated labels such as ransomware, vip, watchlist."
        />
        <Field
          label="Data classification tags"
          name="dataClassificationTags"
          help="Comma-separated labels such as pii, confidential, customer-data."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Select
            label="Severity"
            name="severity"
            options={["low", "medium", "high", "critical"]}
            defaultValue="medium"
          />
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
            defaultValue="other"
          />
          <Select
            label="TLP"
            name="tlp"
            options={["clear", "green", "amber", "amber_strict", "red"]}
            defaultValue="amber"
          />
          <Select
            label="PAP"
            name="pap"
            options={["clear", "green", "amber", "red"]}
            defaultValue="amber"
          />
        </div>
        <div className="flex justify-end">
          <button className="kelpie-btn kelpie-btn-primary">Create case</button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  required,
  as,
  rows,
  help,
}: {
  label: string;
  name: string;
  required?: boolean;
  as?: "input" | "textarea";
  rows?: number;
  help?: string;
}) {
  return (
    <div>
      <label
        htmlFor={`case-${name}`}
        className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
      >
        {label}
      </label>
      {as === "textarea" ? (
        <textarea id={`case-${name}`} name={name} className="kelpie-input" rows={rows ?? 3} required={required} />
      ) : (
        <input id={`case-${name}`} name={name} className="kelpie-input" required={required} />
      )}
      {help ? <p className="text-xs text-slate-500 mt-1">{help}</p> : null}
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
        htmlFor={`case-${name}`}
        className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
      >
        {label}
      </label>
      <select id={`case-${name}`} name={name} className="kelpie-input" defaultValue={defaultValue}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}
