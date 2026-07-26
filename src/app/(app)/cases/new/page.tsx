import { db } from "@/db";
import { cases, caseTemplates } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { createCase } from "@/actions/cases";
import { applyCaseTemplate } from "@/actions/case-templates";
import CreatableTagInput from "@/components/creatable-tag-input";
import { DATA_CLASSIFICATION_SUGGESTIONS, normalizeTags } from "@/lib/tags";

export default async function NewCasePage() {
  const user = await requireUser();
  const [templates, caseTagRows] = await Promise.all([
    db
      .select({
        id: caseTemplates.id,
        name: caseTemplates.name,
        classification: caseTemplates.classification,
      })
      .from(caseTemplates)
      .where(eq(caseTemplates.organisationId, user.organisationId))
      .orderBy(asc(caseTemplates.name)),
    db
      .select({
        tags: cases.tags,
        dataClassificationTags: cases.dataClassificationTags,
      })
      .from(cases)
      .where(eq(cases.organisationId, user.organisationId)),
  ]);
  const tagSuggestions = normalizeTags(
    caseTagRows.flatMap((row) => (Array.isArray(row.tags) ? row.tags as string[] : [])),
  );
  const classificationTagSuggestions = normalizeTags([
    ...DATA_CLASSIFICATION_SUGGESTIONS,
    ...caseTagRows.flatMap((row) =>
      Array.isArray(row.dataClassificationTags)
        ? row.dataClassificationTags as string[]
        : [],
    ),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold mb-1">Open a new case</h1>
        <p className="text-sm text-slate-400">
          A case number is generated automatically per organisation.
        </p>
      </header>

      {templates.length > 0 ? (
        <form action={applyCaseTemplate} className="kelpie-card space-y-4 p-6">
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

      <form action={createCase} className="kelpie-card space-y-6 p-6 md:p-8">
        <div>
          <h2 className="text-base font-medium text-slate-200">Case details</h2>
          <p className="mt-1 text-xs text-slate-500">
            Capture what is known now. Everything remains editable after creation.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,.8fr)]">
          <div className="space-y-5">
            <Field label="Title" name="title" required />
            <Field
              label="Summary"
              name="summary"
              as="textarea"
              rows={6}
              help="What is happening? Stick to facts; the analyst can add detail later."
            />
          </div>
          <div className="space-y-5">
            <CreatableTagInput
              label="Tags"
              name="tags"
              suggestions={tagSuggestions}
              help="Choose an existing tag or type a new one and press Enter."
            />
            <CreatableTagInput
              label="Data classification tags"
              name="dataClassificationTags"
              suggestions={classificationTagSuggestions}
              help="Choose an existing classification tag or create a new one."
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 border-t border-[color:var(--color-navy-700)] pt-6 sm:grid-cols-2 lg:grid-cols-4">
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
        <div className="flex justify-end border-t border-[color:var(--color-navy-700)] pt-5">
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
