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
import CaseReopenForm from "@/components/case-reopen-form";
import { listClosureSnapshotsCore } from "@/lib/closure/close-core";
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
  authorizeCase,
  redactCustomFields,
  resolveUserActor,
} from "@/lib/access";
import { listMappingsForCase } from "@/lib/attack/mapping-core";
import { listStoryCore } from "@/lib/attack/story-core";
import { buildCaseGraphCore } from "@/lib/investigations/graph-core";
import AttackMappingsPanel from "@/components/attack-mappings-panel";
import AttackStoryPanel from "@/components/attack-story-panel";
import InvestigationGraphPanel from "@/components/investigation-graph-panel";
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
import {
  getCasePriorityCore,
  listCriticalContextsForCase,
  recalculateCasePriorityCore,
} from "@/lib/asset-context/priority-core";
import { serialiseContext } from "@/lib/asset-context/context-core";
import { getPriorityScoringSettings } from "@/lib/asset-context/settings";
import { effectiveContextFields } from "@/lib/asset-context/effective";
import CasePriorityPanel from "@/components/case-priority-panel";
import StakeholderPanel from "@/components/stakeholder-panel";
import {
  listCaseExternalContributions,
  listStakeholderInvites,
} from "@/lib/stakeholder";

type Props = { params: Promise<{ id: string }> };

export default async function CaseOverviewPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) notFound();
  const gate = await authorizeCase(
    user.organisationId,
    id,
    actor,
    "view_metadata",
  );
  if (!gate.ok) notFound();

  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.organisationId, user.organisationId)))
    .limit(1);
  if (!c) notFound();

  const [orgUsers, orgPlaybooks, runs, closureSnapshots] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      })
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
    listClosureSnapshotsCore(user.organisationId, id),
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
    attackMappings,
    attackStory,
    prioritySettings,
    investigationGraph,
    stakeholderInvites,
    externalContributions,
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
    listMappingsForCase(user.organisationId, c.id),
    listStoryCore(user.organisationId, c.id),
    getPriorityScoringSettings(user.organisationId),
    buildCaseGraphCore({
      organisationId: user.organisationId,
      caseId: c.id,
      actor,
      permissions: gate.permissions,
      view: "graph",
      nodeLimit: 100,
      edgeLimit: 200,
    }).catch(() => null),
    listStakeholderInvites(user.organisationId, c.id),
    listCaseExternalContributions(user.organisationId, c.id),
  ]);
  let priority = await getCasePriorityCore(user.organisationId, c.id);
  if (!priority) {
    priority = await recalculateCasePriorityCore(user.organisationId, c.id);
  }
  const criticalContexts = (
    await listCriticalContextsForCase(user.organisationId, c.id)
  ).map((row) => {
    const s = serialiseContext(row, {
      staleAfterHours: prioritySettings.staleAfterHours,
    });
    return {
      id: row.id,
      displayName: row.displayName,
      kind: row.kind,
      isStale: s.isStale,
      effective: effectiveContextFields(row),
    };
  });
  const canEdit =
    (user.role === "admin" || user.role === "analyst") &&
    gate.permissions.has("edit");
  const redactedCustomFields = redactCustomFields(
    customFields,
    gate.permissions,
    { actor, grants: gate.ctx.grants },
  );
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

        <CasePriorityPanel
          caseId={c.id}
          canEdit={canEdit}
          criticalContexts={criticalContexts}
          priority={
            priority
              ? {
                  calculatedScore: priority.calculatedScore,
                  effectiveScore: priority.effectiveScore,
                  scoreBand: priority.scoreBand,
                  calculationVersion: priority.calculationVersion,
                  factors: (priority.factors as Array<{
                    id: string;
                    label: string;
                    inputValue: string | number | boolean | null;
                    normalisedScore: number;
                    weight: number;
                    contribution: number;
                    detail: string;
                    staleDiscountApplied?: boolean;
                  }>) ?? [],
                  scoringEnabled: priority.scoringEnabled,
                  hasCriticalContext: priority.hasCriticalContext,
                  hasCrownJewelContext: priority.hasCrownJewelContext,
                  hasStaleContext: priority.hasStaleContext,
                  analystOverrideScore: priority.analystOverrideScore,
                  analystOverrideReason: priority.analystOverrideReason,
                }
              : null
          }
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

        <AttackMappingsPanel
          caseId={c.id}
          entityType="case"
          entityId={c.id}
          canEdit={canEdit}
          mappings={attackMappings.map((m) => ({
            id: m.id,
            entityType: m.entityType,
            entityId: m.entityId,
            techniqueId: m.techniqueId,
            confidence: m.confidence,
            source: m.source,
            notes: m.notes,
            detectionNotes: m.detectionNotes,
            responseNotes: m.responseNotes,
            actorAttribution: m.actorAttribution,
            createdAt: m.createdAt.toISOString(),
            technique: m.technique,
          }))}
        />

        <AttackStoryPanel
          caseId={c.id}
          canEdit={canEdit}
          entries={attackStory.map((e) => ({
            id: e.id,
            sequenceIndex: e.sequenceIndex,
            title: e.title,
            description: e.description,
            provenance: e.provenance,
            sourceRef: e.sourceRef,
            occurredAt: e.occurredAt ? e.occurredAt.toISOString() : null,
            techniqueId: e.techniqueId,
            techniqueName: e.techniqueName,
          }))}
        />

        {investigationGraph ? (
          <InvestigationGraphPanel
            caseId={c.id}
            nodes={investigationGraph.nodes}
            edges={investigationGraph.edges}
            story={investigationGraph.story}
            tacticLanes={investigationGraph.tacticLanes}
            truncated={
              investigationGraph.limits.nodesTruncated ||
              investigationGraph.limits.edgesTruncated
            }
          />
        ) : null}

        <CustomFieldsPanel
          caseId={c.id}
          canEdit={canEdit}
          fields={redactedCustomFields.map((f) => ({
            id: f.id,
            key: f.key,
            label: f.label,
            type: f.type,
            options: f.options,
            required: f.required,
            value: f.value,
            sensitive: f.sensitive,
            redacted: f.redacted,
          }))}
        />

        {c.status === "closed" ? (
          <div className="kelpie-card p-5">
            <h2 className="text-sm font-medium text-slate-300 mb-2">Closure</h2>
            <p className="text-xs text-slate-500 mb-1">
              Closed {c.closedAt ? format(c.closedAt, "PPpp") : ""}
            </p>
            <p className="text-sm text-slate-200">
              <span className="text-slate-500">Disposition:</span> {c.closureReason}
            </p>
            {c.closureDetermination ? (
              <p className="text-sm text-slate-200 mt-1">
                <span className="text-slate-500">Determination:</span>{" "}
                {c.closureDetermination}
              </p>
            ) : null}
            <p className="text-sm text-slate-200 mt-2 whitespace-pre-wrap">
              {c.closureSummary}
            </p>
            {c.rootCause ? (
              <p className="text-sm text-slate-300 mt-2">
                <span className="text-slate-500">Root cause:</span> {c.rootCause}
              </p>
            ) : null}
            {c.businessImpact ? (
              <p className="text-sm text-slate-300 mt-1">
                <span className="text-slate-500">Business impact:</span>{" "}
                {c.businessImpact}
              </p>
            ) : null}
            {c.lessonsLearned ? (
              <p className="text-sm text-slate-300 mt-1">
                <span className="text-slate-500">Lessons learned:</span>{" "}
                {c.lessonsLearned}
              </p>
            ) : null}
            {closureSnapshots.length > 0 ? (
              <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
                <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Closure history
                </h3>
                {closureSnapshots.map((s) => (
                  <div
                    key={s.id}
                    className="rounded border border-slate-800 bg-slate-950/40 p-2 text-xs text-slate-400"
                  >
                    <p>
                      {format(s.closedAt, "PPpp")}
                      {s.wasOverride ? (
                        <span className="ml-2 text-amber-400">override</span>
                      ) : null}
                      {s.reopenedAt ? (
                        <span className="ml-2 text-sky-400">
                          reopened {format(s.reopenedAt, "PPpp")}
                        </span>
                      ) : (
                        <span className="ml-2 text-emerald-400">active</span>
                      )}
                    </p>
                    <p className="mt-0.5">
                      Disposition: {s.disposition}
                      {s.policyVersion != null
                        ? ` · policy v${s.policyVersion}`
                        : ""}
                    </p>
                    {s.wasOverride && s.overrideReason ? (
                      <p className="mt-0.5 text-amber-200/80">
                        Override: {s.overrideReason}
                      </p>
                    ) : null}
                    {s.reopenReason ? (
                      <p className="mt-0.5">Reopen reason: {s.reopenReason}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {canEdit ? (
              <CaseReopenForm
                caseId={c.id}
                caseNumber={c.caseNumber}
                version={c.version}
              />
            ) : null}
          </div>
        ) : (
          <CaseCloseForm
            caseId={c.id}
            caseNumber={c.caseNumber}
            version={c.version}
            canOverride={user.role === "admin"}
            orgUsers={orgUsers.map((u) => ({
              id: u.id,
              name: u.name,
              role: u.role,
            }))}
          />
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

        <StakeholderPanel
          caseId={c.id}
          canWrite={canEdit}
          initialInvites={stakeholderInvites.map((i) => ({
            id: i.id,
            role: i.role,
            purpose: i.purpose,
            status: i.status,
            maxTlp: i.maxTlp,
            maxPap: i.maxPap,
            expiresAt: i.expiresAt.toISOString(),
            collaboratorEmail: i.collaboratorEmail,
            collaboratorName: i.collaboratorName,
            singleUse: i.singleUse,
            createdAt: i.createdAt.toISOString(),
          }))}
          contributions={externalContributions}
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
