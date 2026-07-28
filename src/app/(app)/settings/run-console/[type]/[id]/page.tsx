import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getRun, getRunLineage } from "@/lib/run-console/query";
import { canControlRuns } from "@/lib/run-console/permissions";
import { RUN_TYPES, type RunType } from "@/lib/run-console/types";
import { retryRunAction, cancelRunAction } from "@/actions/run-console";
import LocalDateTime from "@/components/local-date-time";
import MissingRecord from "@/components/missing-record";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-200 break-all">{value}</dd>
    </div>
  );
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ type: string; id: string }>;
}) {
  const user = await requireUser();
  const { type, id } = await params;
  if (!(RUN_TYPES as readonly string[]).includes(type)) {
    return (
      <MissingRecord
        record="Run"
        description="Unknown run type."
        primaryHref="/settings/run-console"
        primaryLabel="Back to run console"
      />
    );
  }
  const runType = type as RunType;
  const run = await getRun(user.organisationId, runType, id);
  if (!run) {
    return (
      <MissingRecord
        record="Run"
        description="This run may not exist, or it may belong to another organisation."
        primaryHref="/settings/run-console"
        primaryLabel="Back to run console"
      />
    );
  }
  const lineage = await getRunLineage(user.organisationId, runType, run.lineage.rootRunId ?? run.id);
  const controlAllowed = canControlRuns(user);
  const killSwitchArmed =
    run.killSwitch.organisationActive || run.killSwitch.providerActive || run.killSwitch.actionActive;

  return (
    <div className="kelpie-page max-w-4xl">
      <header>
        <Link href="/settings/run-console" className="text-xs text-slate-400 hover:text-slate-200">
          ← Run console
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{run.trigger}</h1>
        <p>
          {run.caseNumber ? `${run.caseNumber} · ` : ""}
          Attempt {run.lineage.attempt} · {run.state}
        </p>
      </header>

      {killSwitchArmed ? (
        <section className="kelpie-section border-2 border-[color:var(--color-danger,#b91c1c)]">
          <div className="kelpie-section-header">
            <h2 className="text-[color:var(--color-danger,#b91c1c)]">Kill switch armed</h2>
            <p>
              {run.killSwitch.organisationActive ? "Organisation-wide. " : ""}
              {run.killSwitch.providerActive ? "Provider-level. " : ""}
              {run.killSwitch.actionActive ? "Action-level." : ""}
            </p>
          </div>
        </section>
      ) : null}

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Summary</h2>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Run ID" value={run.id} />
          <Field label="Run type" value={run.runType} />
          <Field label="Action/rule ID" value={run.actionId ?? "—"} />
          <Field label="Reference" value={run.ruleOrActionRef ?? "—"} />
          <Field label="Provider" value={run.provider ?? "—"} />
          <Field label="State" value={run.state} />
          <Field label="Provider request ID" value={run.providerRequestId ?? "—"} />
          <Field label="Error category" value={run.errorCategory ?? "—"} />
          <Field label="Requested by" value={run.approval.requestedBy?.label ?? run.approval.requestedBy?.id ?? "—"} />
          <Field label="Approved by" value={run.approval.approvedBy?.label ?? run.approval.approvedBy?.id ?? "—"} />
          <Field
            label="Approval expiry"
            value={run.approval.expiresAt ? new Date(run.approval.expiresAt).toISOString() : "—"}
          />
          <Field
            label="Cancel requested"
            value={run.cancel.requested ? `Yes, by ${run.cancel.requestedBy?.label ?? run.cancel.requestedBy?.id ?? "unknown"}` : "No"}
          />
        </dl>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Timing</h2>
        </div>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Queued</dt>
            <dd className="text-sm text-slate-200">
              {run.timestamps.queuedAt ? (
                <LocalDateTime value={run.timestamps.queuedAt} timeZone={user.timezone} />
              ) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Started</dt>
            <dd className="text-sm text-slate-200">
              {run.timestamps.startedAt ? (
                <LocalDateTime value={run.timestamps.startedAt} timeZone={user.timezone} />
              ) : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wider text-slate-500">Finished</dt>
            <dd className="text-sm text-slate-200">
              {run.timestamps.finishedAt ? (
                <LocalDateTime value={run.timestamps.finishedAt} timeZone={user.timezone} />
              ) : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {run.errorSummary ? (
        <section className="kelpie-section">
          <div className="kelpie-section-header">
            <h2>Error</h2>
            <p>Support-safe: redacted before it ever reached this page.</p>
          </div>
          <p className="text-sm text-slate-300 break-all">{run.errorSummary}</p>
        </section>
      ) : null}

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Input summary</h2>
          <p>Redacted before persistence and display. Never contains credentials or raw payloads.</p>
        </div>
        <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
          {JSON.stringify(run.inputSummary, null, 2)}
        </pre>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Output summary</h2>
        </div>
        <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
          {JSON.stringify(run.outputSummary, null, 2)}
        </pre>
      </section>

      {lineage.length > 1 ? (
        <section className="kelpie-section">
          <div className="kelpie-section-header">
            <h2>Retry lineage</h2>
            <p>Oldest attempt first. Retry always creates a new row; nothing here is ever rewritten.</p>
          </div>
          <div className="kelpie-scroll-x" tabIndex={0} aria-label="Retry lineage table">
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Attempt</th>
                  <th>Run ID</th>
                  <th>State</th>
                  <th>Finished</th>
                </tr>
              </thead>
              <tbody>
                {lineage.map((attempt) => (
                  <tr key={attempt.id} className={attempt.id === run.id ? "font-semibold" : ""}>
                    <td className="text-xs text-slate-300">{attempt.lineage.attempt}</td>
                    <td className="text-xs text-slate-300">
                      <Link href={`/settings/run-console/${attempt.runType}/${encodeURIComponent(attempt.id)}`} className="kelpie-link">
                        {attempt.id}
                      </Link>
                    </td>
                    <td className="text-xs text-slate-300">{attempt.state}</td>
                    <td className="whitespace-nowrap text-xs text-slate-400">
                      {attempt.timestamps.finishedAt ? (
                        <LocalDateTime value={attempt.timestamps.finishedAt} timeZone={user.timezone} />
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {controlAllowed && (run.retryable || run.cancellable) ? (
        <section className="kelpie-section">
          <div className="kelpie-section-header">
            <h2>Controls</h2>
          </div>
          <div className="flex gap-3">
            {run.retryable ? (
              <form action={retryRunAction}>
                <input type="hidden" name="runType" value={run.runType} />
                <input type="hidden" name="runId" value={run.id} />
                <button type="submit" className="kelpie-btn kelpie-btn-primary">
                  Retry (new attempt)
                </button>
              </form>
            ) : null}
            {run.cancellable ? (
              <form action={cancelRunAction}>
                <input type="hidden" name="runType" value={run.runType} />
                <input type="hidden" name="runId" value={run.id} />
                <button type="submit" className="kelpie-btn kelpie-btn-secondary">
                  Cancel (best effort)
                </button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
