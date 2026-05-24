import { createCase } from "@/actions/cases";

export default function NewCasePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">Open a new case</h1>
      <p className="text-sm text-slate-400 mb-5">
        A case number is generated automatically per organisation.
      </p>
      <form action={createCase} className="kelpie-card p-6 space-y-4">
        <Field label="Title" name="title" required />
        <Field
          label="Summary"
          name="summary"
          as="textarea"
          rows={4}
          help="What is happening? Stick to facts; the analyst can add detail later."
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
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>
      {as === "textarea" ? (
        <textarea name={name} className="kelpie-input" rows={rows ?? 3} required={required} />
      ) : (
        <input name={name} className="kelpie-input" required={required} />
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
      <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
        {label}
      </label>
      <select name={name} className="kelpie-input" defaultValue={defaultValue}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </div>
  );
}
