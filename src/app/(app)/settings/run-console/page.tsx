import Link from "next/link";
import { requireUser } from "@/lib/session";
import { listRuns } from "@/lib/run-console/query";
import { listKillSwitches, KNOWN_PROVIDERS } from "@/lib/run-console/kill-switch";
import { canControlRuns, canManageKillSwitches } from "@/lib/run-console/permissions";
import { RUN_STATES, RUN_TYPES, type RunFilters, type RunState, type RunType } from "@/lib/run-console/types";
import { retryRunAction, cancelRunAction, setKillSwitchAction } from "@/actions/run-console";
import LocalDateTime from "@/components/local-date-time";

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_KEYS = ["caseId", "runType", "action", "provider", "state", "result", "actorId", "from", "to"] as const;

function first(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ?? "";
}

function filtersFromParams(raw: Record<string, string>): RunFilters {
  return {
    caseId: raw.caseId || undefined,
    runType: (RUN_TYPES as readonly string[]).includes(raw.runType) ? (raw.runType as RunType) : undefined,
    action: raw.action || undefined,
    provider: raw.provider || undefined,
    state: (RUN_STATES as readonly string[]).includes(raw.state) ? (raw.state as RunState) : undefined,
    result:
      raw.result === "success" || raw.result === "failure" || raw.result === "partial"
        ? raw.result
        : undefined,
    actorId: raw.actorId || undefined,
    from: raw.from ? new Date(raw.from) : undefined,
    to: raw.to ? new Date(raw.to) : undefined,
  };
}

const RUN_TYPE_LABELS: Record<RunType, string> = {
  response_action: "Response action",
  automation: "Automation",
  enrichment: "Enrichment",
  case_source_poll: "Case source poll",
  ti_feed_poll: "TI feed poll",
  notification: "Notification",
  report: "Report",
};

const STATE_LABELS: Record<RunState, string> = {
  queued: "Queued",
  running: "Running",
  waiting_approval: "Waiting approval",
  succeeded: "Succeeded",
  partially_succeeded: "Partially succeeded",
  failed: "Failed",
  cancelled: "Cancelled",
};

export default async function RunConsolePage({ searchParams }: { searchParams: RawSearchParams }) {
  const user = await requireUser();
  const raw = await searchParams;
  const filterValues = Object.fromEntries(
    FILTER_KEYS.map((key) => [key, first(raw[key])]),
  ) as Record<(typeof FILTER_KEYS)[number], string>;
  const filters = filtersFromParams(filterValues);

  const [{ runs }, killSwitches] = await Promise.all([
    listRuns(user.organisationId, filters),
    listKillSwitches(user.organisationId),
  ]);

  const controlAllowed = canControlRuns(user);
  const killSwitchAllowed = canManageKillSwitches(user);
  const orgSwitch = killSwitches.find((s) => s.scope === "organisation" && s.enabled);

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Run console</h1>
        <p>
          One place for every automation and response-action run: agent hand-offs, governed
          response actions, enrichment sweeps, case-source and TI feed polls, notification
          deliveries, and report generation, with retry lineage and kill switches.
        </p>
      </header>

      {orgSwitch ? (
        <section className="kelpie-section border-2 border-[color:var(--color-danger,#b91c1c)]">
          <div className="kelpie-section-header">
            <h2 className="text-[color:var(--color-danger,#b91c1c)]">
              Organisation kill switch is ARMED
            </h2>
            <p>Reason: {orgSwitch.reason}</p>
          </div>
        </section>
      ) : null}

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Filters</h2>
          <p>Narrow by case, run type, action, provider, state, result, actor, or date.</p>
        </div>
        <form method="get" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="kelpie-field">
            <label htmlFor="filter-caseId" className="kelpie-label">Case ID</label>
            <input id="filter-caseId" name="caseId" defaultValue={filterValues.caseId} className="kelpie-input" />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-runType" className="kelpie-label">Run type</label>
            <select id="filter-runType" name="runType" defaultValue={filterValues.runType} className="kelpie-input">
              <option value="">All</option>
              {RUN_TYPES.map((type) => (
                <option key={type} value={type}>{RUN_TYPE_LABELS[type]}</option>
              ))}
            </select>
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-action" className="kelpie-label">Action/rule ID</label>
            <input id="filter-action" name="action" defaultValue={filterValues.action} className="kelpie-input" />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-provider" className="kelpie-label">Provider</label>
            <input id="filter-provider" name="provider" defaultValue={filterValues.provider} className="kelpie-input" />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-state" className="kelpie-label">State</label>
            <select id="filter-state" name="state" defaultValue={filterValues.state} className="kelpie-input">
              <option value="">All</option>
              {RUN_STATES.map((state) => (
                <option key={state} value={state}>{STATE_LABELS[state]}</option>
              ))}
            </select>
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-result" className="kelpie-label">Result</label>
            <select id="filter-result" name="result" defaultValue={filterValues.result} className="kelpie-input">
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="partial">Partial</option>
            </select>
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-actorId" className="kelpie-label">Actor ID</label>
            <input id="filter-actorId" name="actorId" defaultValue={filterValues.actorId} className="kelpie-input" />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-from" className="kelpie-label">From</label>
            <input id="filter-from" type="datetime-local" name="from" defaultValue={filterValues.from} className="kelpie-input" />
          </div>
          <div className="kelpie-field">
            <label htmlFor="filter-to" className="kelpie-label">To</label>
            <input id="filter-to" type="datetime-local" name="to" defaultValue={filterValues.to} className="kelpie-input" />
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className="kelpie-btn kelpie-btn-primary">Apply filters</button>
            <Link href="/settings/run-console" className="kelpie-btn kelpie-btn-ghost">Clear filters</Link>
          </div>
        </form>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Runs</h2>
          <p>Most recent first. Retry always creates a new attempt; it never rewrites history.</p>
        </div>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-400">No runs match these filters.</p>
        ) : (
          <div className="kelpie-scroll-x" tabIndex={0} aria-label="Runs table">
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Queued</th>
                  <th>Type</th>
                  <th>Trigger</th>
                  <th>Case</th>
                  <th>Provider</th>
                  <th>State</th>
                  <th>Attempt</th>
                  <th>Error category</th>
                  <th>Kill switch</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={`${run.runType}:${run.id}`}>
                    <td className="whitespace-nowrap text-xs text-slate-400">
                      <LocalDateTime
                        value={run.timestamps.queuedAt ?? run.timestamps.startedAt ?? new Date().toISOString()}
                        timeZone={user.timezone}
                      />
                    </td>
                    <td className="text-xs text-slate-300">{RUN_TYPE_LABELS[run.runType]}</td>
                    <td className="text-xs text-slate-200">
                      <Link href={`/settings/run-console/${run.runType}/${encodeURIComponent(run.id)}`} className="kelpie-link">
                        {run.trigger}
                      </Link>
                    </td>
                    <td className="text-xs text-slate-300">{run.caseNumber ?? ""}</td>
                    <td className="text-xs text-slate-300">{run.provider ?? ""}</td>
                    <td className="text-xs text-slate-300">{STATE_LABELS[run.state]}</td>
                    <td className="text-xs text-slate-400">{run.lineage.attempt}</td>
                    <td className="text-xs text-slate-400">{run.errorCategory ?? ""}</td>
                    <td className="text-xs text-slate-400">
                      {run.killSwitch.organisationActive || run.killSwitch.providerActive || run.killSwitch.actionActive
                        ? "Armed"
                        : ""}
                    </td>
                    <td className="text-right text-xs">
                      {controlAllowed && run.retryable ? (
                        <form action={retryRunAction} className="inline">
                          <input type="hidden" name="runType" value={run.runType} />
                          <input type="hidden" name="runId" value={run.id} />
                          <button type="submit" className="kelpie-link">Retry</button>
                        </form>
                      ) : null}
                      {controlAllowed && run.cancellable ? (
                        <form action={cancelRunAction} className="ml-2 inline">
                          <input type="hidden" name="runType" value={run.runType} />
                          <input type="hidden" name="runId" value={run.id} />
                          <button type="submit" className="kelpie-link">Cancel</button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Kill switches</h2>
          <p>
            Prominent, reasoned, and audited. Every switch is checked both when a run is claimed
            and immediately before it contacts a provider.
          </p>
        </div>
        {killSwitchAllowed ? (
          <form action={setKillSwitchAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="kelpie-field">
              <label htmlFor="ks-scope" className="kelpie-label">Scope</label>
              <select id="ks-scope" name="scope" className="kelpie-input" defaultValue="organisation">
                <option value="organisation">Organisation</option>
                <option value="provider">Provider</option>
                <option value="action">Action/rule</option>
              </select>
            </div>
            <div className="kelpie-field">
              <label htmlFor="ks-scopeKey" className="kelpie-label">Scope key</label>
              <input id="ks-scopeKey" name="scopeKey" list="known-providers" className="kelpie-input" placeholder="cloudflare, or an action/rule ID" />
              <datalist id="known-providers">
                {KNOWN_PROVIDERS.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="kelpie-field sm:col-span-2">
              <label htmlFor="ks-reason" className="kelpie-label">Reason</label>
              <input id="ks-reason" name="reason" required className="kelpie-input" placeholder="Why is this being armed or cleared?" />
            </div>
            <div className="kelpie-field">
              <label htmlFor="ks-enabled" className="kelpie-label">Action</label>
              <select id="ks-enabled" name="enabled" className="kelpie-input" defaultValue="true">
                <option value="true">Arm (stop work)</option>
                <option value="false">Clear (resume)</option>
              </select>
            </div>
            <div className="flex items-end sm:col-span-2 lg:col-span-5">
              <button type="submit" className="kelpie-btn kelpie-btn-primary">Apply kill switch</button>
            </div>
          </form>
        ) : (
          <p className="text-xs text-slate-500">Only administrators can change kill switches.</p>
        )}

        {killSwitches.length > 0 ? (
          <div className="kelpie-scroll-x mt-4" tabIndex={0} aria-label="Kill switches table">
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Key</th>
                  <th>Enabled</th>
                  <th>Reason</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {killSwitches.map((ks) => (
                  <tr key={ks.id}>
                    <td className="text-xs text-slate-300">{ks.scope}</td>
                    <td className="text-xs text-slate-300">{ks.scopeKey || "(org-wide)"}</td>
                    <td className="text-xs text-slate-300">{ks.enabled ? "Armed" : "Clear"}</td>
                    <td className="text-xs text-slate-400">{ks.reason}</td>
                    <td className="whitespace-nowrap text-xs text-slate-400">
                      <LocalDateTime value={ks.updatedAt.toISOString()} timeZone={user.timezone} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-500">No kill switches configured.</p>
        )}
      </section>
    </div>
  );
}
