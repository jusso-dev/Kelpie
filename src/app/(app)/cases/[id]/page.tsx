import { db } from "@/db";
import {
  cases,
  users,
  playbooks,
  playbookRuns,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { closeCase } from "@/actions/cases";
import { CaseControls } from "@/components/case-controls";
import { MITRE_TECHNIQUES, findTechnique } from "@/data/mitre";
import MitrePicker from "@/components/mitre-picker";
import PlaybookStarter from "@/components/playbook-starter";
import SlaPanel from "@/components/sla-panel";
import CasePresence from "@/components/case-presence";
import CustomFieldsPanel from "@/components/custom-fields-panel";
import CaseActionRunner from "@/components/case-action-runner";
import { evaluateSla, loadSlaPolicy } from "@/lib/sla";
import { getCustomFieldsForEntity } from "@/lib/custom-fields";
import { listAvailableActions } from "@/lib/response-actions/core";
import { format } from "date-fns";

type Props = { params: Promise<{ id: string }> };

export default async function CaseOverviewPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.organisationId, user.organisationId)))
    .limit(1);
  if (!c) notFound();

  const [orgUsers, orgPlaybooks, runs] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.organisationId, user.organisationId)),
    db
      .select({ id: playbooks.id, name: playbooks.name })
      .from(playbooks)
      .where(
        and(
          eq(playbooks.organisationId, user.organisationId),
          eq(playbooks.isActive, true),
        ),
      ),
    db
      .select({
        id: playbookRuns.id,
        playbookId: playbookRuns.playbookId,
        startedAt: playbookRuns.startedAt,
        playbookName: playbooks.name,
      })
      .from(playbookRuns)
      .innerJoin(playbooks, eq(playbooks.id, playbookRuns.playbookId))
      .where(eq(playbookRuns.caseId, id)),
  ]);

  const techniques = (c.mitreTechniques as string[]) ?? [];
  const slaPolicy = await loadSlaPolicy(user.organisationId, c.severity);
  const slaEvaluation = slaPolicy ? evaluateSla(c, slaPolicy) : null;
  const [customFields, availableActions] = await Promise.all([
    getCustomFieldsForEntity(user.organisationId, c.id),
    listAvailableActions(user.organisationId, c.id),
  ]);
  const canEdit = user.role === "admin" || user.role === "analyst";

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        <div className="kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-2">Summary</h2>
          <p className="text-sm text-slate-200 whitespace-pre-wrap">
            {c.summary || (
              <span className="text-slate-500">No summary yet.</span>
            )}
          </p>
        </div>

        <div className="kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-3">
            MITRE ATT&CK techniques
          </h2>
          {techniques.length === 0 ? (
            <p className="text-sm text-slate-500 mb-2">No techniques tagged.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 mb-3">
              {techniques.map((tid) => {
                const t = findTechnique(tid);
                return (
                  <li
                    key={tid}
                    className="text-xs px-2 py-1 rounded border border-[color:var(--color-tan-500)] text-[color:var(--color-tan-300)]"
                  >
                    {tid}
                    {t ? ` — ${t.name}` : ""}
                  </li>
                );
              })}
            </ul>
          )}
          <MitrePicker
            caseId={c.id}
            selected={techniques}
            techniques={MITRE_TECHNIQUES}
          />
        </div>

        <CustomFieldsPanel
          caseId={c.id}
          canEdit={canEdit}
          fields={customFields.map((f) => ({
            id: f.id,
            key: f.key,
            label: f.label,
            type: f.type,
            options: f.options,
            required: f.required,
            value: f.value,
          }))}
        />

        {c.status === "closed" ? (
          <div className="kelpie-card p-5">
            <h2 className="text-sm font-medium text-slate-300 mb-2">Closure</h2>
            <p className="text-xs text-slate-500 mb-1">
              Closed {c.closedAt ? format(c.closedAt, "PPpp") : ""}
            </p>
            <p className="text-sm text-slate-200">
              <span className="text-slate-500">Reason:</span> {c.closureReason}
            </p>
            <p className="text-sm text-slate-200 mt-2 whitespace-pre-wrap">
              {c.closureSummary}
            </p>
          </div>
        ) : (
          <form
            action={closeCase}
            className="kelpie-card p-5 space-y-3 border-amber-700/50"
          >
            <input type="hidden" name="caseId" value={c.id} />
            <h2 className="text-sm font-medium text-slate-300">Close this case</h2>
            <div>
              <label
                htmlFor="closure-reason"
                className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
              >
                Closure reason
              </label>
              <select id="closure-reason" name="reason" className="kelpie-input" required>
                <option value="resolved">Resolved</option>
                <option value="false_positive">False positive</option>
                <option value="duplicate">Duplicate</option>
                <option value="benign">Benign</option>
                <option value="risk_accepted">Risk accepted</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="closure-summary"
                className="block text-xs uppercase tracking-wider text-slate-400 mb-1"
              >
                Summary for the record
              </label>
              <textarea
                id="closure-summary"
                name="summary"
                className="kelpie-input"
                rows={4}
                required
                placeholder="Short narrative of what happened, what was done, and what to watch for."
              />
            </div>
            <div className="flex justify-end">
              <button className="kelpie-btn kelpie-btn-danger">Close case</button>
            </div>
          </form>
        )}
      </div>

      <aside className="space-y-4">
        <CasePresence caseId={c.id} />
        <SlaPanel evaluation={slaEvaluation} />
        <CaseControls
          caseId={c.id}
          version={c.version}
          status={c.status}
          severity={c.severity}
          tlp={c.tlp}
          pap={c.pap}
          classification={c.classification}
          tags={Array.isArray(c.tags) ? (c.tags as string[]) : []}
          dataClassificationTags={
            Array.isArray(c.dataClassificationTags)
              ? (c.dataClassificationTags as string[])
              : []
          }
          assigneeId={c.assigneeId}
          users={orgUsers}
        />

        <CaseActionRunner
          caseId={c.id}
          canRun={canEdit}
          actions={availableActions.map((a) => ({
            id: a.id,
            name: a.name,
            label: a.label,
            description: a.description,
            inputFields: a.inputFields,
          }))}
        />

        <div className="kelpie-card p-5">
          <h2 className="text-sm font-medium text-slate-300 mb-2">Playbooks</h2>
          {orgPlaybooks.length === 0 ? (
            <p className="text-xs text-slate-500 mb-2">
              No active playbooks. Create one under Playbooks.
            </p>
          ) : (
            <PlaybookStarter caseId={c.id} playbooks={orgPlaybooks} />
          )}
          {runs.length > 0 ? (
            <ul className="mt-3 text-xs space-y-1">
              {runs.map((r) => (
                <li key={r.id} className="text-slate-400">
                  {r.playbookName} started {format(r.startedAt, "PP p")}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
