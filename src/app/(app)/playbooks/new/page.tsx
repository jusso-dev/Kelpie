import { createPlaybook } from "@/actions/playbooks";
import PlaybookStepsEditor from "@/components/playbook-steps-editor";

export default function NewPlaybookPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1">New playbook</h1>
      <p className="text-sm text-slate-400 mb-5">
        Each step becomes a task when the playbook is applied. The cadence
        offset is the number of minutes after playbook start that the task is
        due.
      </p>
      <form action={createPlaybook} className="kelpie-card p-6 space-y-4">
        <div>
          <label
            htmlFor="playbook-name"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Name
          </label>
          <input id="playbook-name" name="name" className="kelpie-input" required />
        </div>
        <div>
          <label
            htmlFor="playbook-description"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Description
          </label>
          <textarea id="playbook-description" name="description" className="kelpie-input" rows={3} />
        </div>
        <div>
          <label
            htmlFor="playbook-classification"
            className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
          >
            Classification
          </label>
          <select id="playbook-classification" name="classification" className="kelpie-input" defaultValue="other">
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
        <PlaybookStepsEditor />
        <div className="flex justify-end">
          <button className="kelpie-btn kelpie-btn-primary">Create playbook</button>
        </div>
      </form>
    </div>
  );
}
