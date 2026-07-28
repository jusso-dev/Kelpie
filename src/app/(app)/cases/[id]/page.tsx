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
import CaseCloseForm from "@/components/case-close-form";
import { CaseControls } from "@/components/case-controls";
import { MITRE_TECHNIQUES, findTechnique } from "@/data/mitre";
import MitrePicker from "@/components/mitre-picker";
import PlaybookStarter from "@/components/playbook-starter";
import SlaPanel from "@/components/sla-panel";
import CasePresence from "@/components/case-presence";
import CustomFieldsPanel from "@/components/custom-fields-panel";
import CaseActionRunner from "@/components/case-action-runner";
import CaseRelationshipsPanel from "@/components/case-relationships-panel";
import { QueueOwnershipPanel } from "@/components/queue-ownership-panel";
import { WatchersPanel } from "@/components/watchers-panel";
import { HandoffPanel } from "@/components/handoff-panel";
import { evaluateSla, loadSlaPolicy } from "@/lib/sla";
import {
  listRelationshipsCore,
  listSuggestionsCore,
} from "@/lib/case-relationships-core";
import { getCustomFieldsForEntity } from "@/lib/custom-fields";
import {
  listAvailableActions,
  listCaseResponseActionRuns,
} from "@/lib/response-actions/core";
import { format } from "date-fns";
import CaseSummaryEditor from "@/components/case-summary-editor";
import { sourceSystemLabel } from "@/lib/case-source-identity";
import { safeExternalUrl } from "@/lib/safe-url";
import { listAdditionalAssigneesCore, listQueuesCore } from "@/lib/queues-core";
import { listWatchersCore } from "@/lib/watchers-core";
import { listHandoffsCore } from "@/lib/handoffs-core";

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
  const [
    customFields,
    availableActions,
    responseActionRuns,
    relationships,
    suggestions,
    queueOptions,
    additionalAssignees,
    watchers,
    handoffs,
  ] = await Promise.all([
    getCustomFieldsForEntity(user.organisationId, c.id),
    listAvailableActions(user.organisationId, c.id),
    listCaseResponseActionRuns(user.organisationId, c.id),
    listRelationshipsCore(user.organisationId, c.id),
    listSuggestionsCore(user.organisationId, c.id),
    listQueuesCore(user.organisationId),
    listAdditionalAssigneesCore(user.organisationId, c.id),
    listWatchersCore(user.organisationId, c.id),
    listHandoffsCore(user.organisationId, c.id),
  ]);
  const canEdit = user.role === "admin" || user.role === "analyst";
  const sourceLabel = sourceSystemLabel(c.sourceSystem);
  // Re-validated at render time: a legacy row or a bypass of the public API's
  // ingest validation could still hold a non-http(s) `source_url`.
  const sourceHref = safeExternalUrl(c.sourceUrl);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-4">
        {sourceLabel ? (
          <div className="kelpie-notice kelpie-notice-block">
            Imported from {sourceLabel}
            {c.sourceReference ? (
              <>
                {" · Reference "}
                <span className="font-mono text-xs text-slate-400">
                  {c.sourceReference}
                </span>
              </>
            ) : null}
            {sourceHref ? (
              <>
                {" · "}
                <a
                  href={sourceHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kelpie-link"
                >
                  View source incident
                </a>
              </>
            ) : null}
          </div>
        ) : null}
        <CaseSummaryEditor
          caseId={c.id}
          summary={c.summary}
          version={c.version}
          canEdit={canEdit}
        />

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
            version={c.version}
            canEdit={canEdit}
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
          <CaseCloseForm caseId={c.id} caseNumber={c.caseNumber} />
        )}
      </div>

      <aside className="space-y-4">
        <CasePresence />
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

        <QueueOwnershipPanel
          caseId={c.id}
          queueId={c.queueId}
          queueAssignedAt={c.queueAssignedAt ? c.queueAssignedAt.toISOString() : null}
          assigneeAssignedAt={c.assigneeAssignedAt ? c.assigneeAssignedAt.toISOString() : null}
          acknowledgedAt={c.acknowledgedAt ? c.acknowledgedAt.toISOString() : null}
          waitingReason={c.waitingReason}
          waitingSince={c.waitingSince ? c.waitingSince.toISOString() : null}
          queues={queueOptions.map((q) => ({ id: q.id, name: q.name, teamName: q.teamName }))}
          members={orgUsers.map((u) => ({ id: u.id, name: u.name }))}
          additionalAssignees={additionalAssignees.map((a) => ({
            userId: a.userId,
            userName: a.userName,
          }))}
          canEdit={canEdit}
        />

        <WatchersPanel
          caseId={c.id}
          currentUserId={user.id}
          watchers={watchers.map((w) => ({
            userId: w.userId,
            userName: w.userName,
            notifyOnComment: w.notifyOnComment,
            notifyOnStatusChange: w.notifyOnStatusChange,
            notifyOnAssignment: w.notifyOnAssignment,
            notifyOnSlaRisk: w.notifyOnSlaRisk,
          }))}
          members={orgUsers.map((u) => ({ id: u.id, name: u.name }))}
          canManageOthers={canEdit}
        />

        <HandoffPanel
          caseId={c.id}
          handoffs={handoffs.map((h) => ({
            id: h.id,
            summary: h.summary,
            keyActions: Array.isArray(h.keyActions) ? (h.keyActions as string[]) : [],
            openItems: Array.isArray(h.openItems) ? (h.openItems as string[]) : [],
            fromUserId: h.fromUserId,
            toUserId: h.toUserId,
            createdAt: h.createdAt.toISOString(),
          }))}
          members={orgUsers.map((u) => ({ id: u.id, name: u.name }))}
          canCreate={canEdit}
        />

        <CaseActionRunner
          caseId={c.id}
          canRun={canEdit}
          actions={availableActions.map((a) => ({
            id: a.id,
            name: a.name,
            label: a.label,
            description: a.description,
            approvalRequired: a.approvalRequired,
            inputFields: a.inputFields,
          }))}
          runs={responseActionRuns}
          currentUserId={user.id}
          canApprove={user.role === "admin"}
        />

        <CaseRelationshipsPanel
          caseId={c.id}
          canEdit={canEdit}
          relationships={relationships.map((r) => ({
            id: r.id,
            relationshipType: r.relationshipType,
            direction: r.direction,
            confidence: r.confidence,
            origin: r.origin,
            reason: r.reason,
            createdAt: r.createdAt.toISOString(),
            otherCase: r.otherCase,
          }))}
          suggestions={suggestions}
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
