import Link from "next/link";
import CopyTextButton from "@/components/copy-text-button";
import PageExplainer from "@/components/page-explainer";
import { LLM_AGENT_PROMPT } from "@/lib/llm-prompt";

const guideLinks = [
  ["triage-and-dashboard", "Triage and dashboard"],
  ["case-queue-and-views", "Case queue and views"],
  ["cases-and-templates", "Cases and templates"],
  ["queues-and-workload", "Queues and workload"],
  ["task-inbox", "Task inbox"],
  ["observables-and-iocs", "Observables and IOCs"],
  ["tags-and-custom-fields", "Tags and custom fields"],
  ["threat-intelligence", "Threat intelligence"],
  ["cyber-brief-and-landscape", "Cyber brief and landscape"],
  ["integrations-and-enrichment", "Integrations and enrichment"],
  ["automation-jobs", "Automation jobs"],
  ["attack-coverage", "ATT&CK coverage"],
  ["asset-context", "Assets and identities"],
  ["settings-and-roles", "Settings and roles"],
  ["api-and-mcp", "API and MCP"],
  ["playbooks-and-agents", "Playbooks and agents (LLM.txt)"],
] as const;

export default function GuidesPage() {
  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <h1>Guides</h1>
        <PageExplainer page="guides" />
      </header>

      <div className="grid gap-8 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav
          aria-label="Guide contents"
          className="h-fit border-l border-[color:var(--color-navy-700)] pl-4 lg:sticky lg:top-6"
        >
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            On this page
          </p>
          <ul className="space-y-2 text-sm">
            {guideLinks.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="text-slate-400 hover:text-slate-100"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 divide-y divide-[color:var(--color-navy-700)]">
          <GuideSection
            id="triage-and-dashboard"
            title="Triage and dashboard"
            intro="The overview is for handoff and load awareness. Investigation still happens on the case."
          >
            <GuideSteps
              steps={[
                <>
                  Open <LinkText href="/dashboard">Overview</LinkText> at the
                  start of a shift. Check active cases, SLA breaches, and MTTA /
                  MTTC / MTTR before diving into one ticket.
                </>,
                <>
                  Administrators see a{" "}
                  <strong className="font-medium text-slate-200">
                    Team caseload
                  </strong>{" "}
                  panel: per-analyst active cases, severity-weighted score, and
                  overload flags when someone is well above the team average.
                </>,
                <>
                  Jump from an overloaded card into that analyst&rsquo;s cases,
                  rebalance ownership, or pull unassigned work into a lighter
                  queue. Full queue health lives under{" "}
                  <LinkText href="/queues">Queues</LinkText>.
                </>,
                <>
                  Treat severity bars and top classifications as prioritisation
                  hints. Open the case for evidence, comments, and actions.
                </>,
              ]}
            />
            <GuideNote>
              Weighting for caseload: low = 1, medium = 2, high = 4, critical =
              8. Closed cases are excluded. Primary owner and additional
              assignees both count toward load.
            </GuideNote>
          </GuideSection>

          <GuideSection
            id="case-queue-and-views"
            title="Case queue and views"
            intro="The case list is the day-to-day triage surface. Saved views keep a shared filter set one click away."
          >
            <GuideSteps
              steps={[
                <>
                  Open <LinkText href="/cases">Cases</LinkText>. Use operational
                  views (mine, unassigned, SLA warning, SLA breached, stale) for
                  common triage cuts.
                </>,
                <>
                  Combine filters (status, severity, assignee, queue, tag,
                  source) until the list matches how your team works. Share the
                  URL — filters are query parameters.
                </>,
                <>
                  Administrators and analysts with permission can save a view so
                  the whole team (or a team membership) reuses the same cut.
                  Dirty state means the URL no longer matches the saved view.
                </>,
                <>
                  Keep ownership and status honest: every open case should have
                  a clear next owner (person or queue) and a status that matches
                  reality. That is what makes SLA and caseload numbers trustworthy.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="cases-and-templates"
            title="Cases and templates"
            intro="A case is the durable record for an investigation. Start with facts, then add tasks, comments, observables, evidence, and ownership as work progresses."
          >
            <GuideSteps
              steps={[
                <>
                  Open <LinkText href="/cases/new">New case</LinkText> and
                  record a clear title, factual summary, severity, and handling
                  markings (TLP / PAP).
                </>,
                <>
                  Prefer one investigation per case. Link related cases rather
                  than stuffing unrelated activity into one timeline.
                </>,
                <>
                  Use <LinkText href="/playbooks">Playbooks</LinkText> for
                  repeatable response work. Use case templates when the same
                  initial fields and structure recur.
                </>,
                <>
                  Update status as the incident lifecycle moves: open →
                  in_progress → contained → eradicated → recovered → closed.
                  Record why you closed (or reopened) so the audit trail stays
                  useful.
                </>,
                <>
                  Comment for human narrative; timeline captures structured
                  state changes. @mentions notify teammates — keep secrets out of
                  notification-facing text when you can.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="queues-and-workload"
            title="Queues and workload"
            intro="Team queues hold work before an individual owns it. Workload shows who is carrying the heaviest active load."
          >
            <GuideSteps
              steps={[
                <>
                  Administrators create teams and queues under{" "}
                  <LinkText href="/queues">Queues</LinkText>. Assign analysts to
                  teams so membership is clear.
                </>,
                <>
                  Route a case to a queue when the next step is team ownership,
                  not a named person yet. Queue assignment does not set
                  individual owner until someone picks it up.
                </>,
                <>
                  Watch per-analyst weighted load and queue aging / SLA risk.
                  Pull work from overloaded people into lighter capacity or into
                  an unassigned queue bucket.
                </>,
                <>
                  On the admin dashboard, Team caseload is a compressed view of
                  the same workload data for shift leads.
                </>,
              ]}
            />
            <GuideNote>
              Severity weight is intentional: five low cases are not the same
              load as two criticals. Rebalance on weighted score, not raw count
              alone.
            </GuideNote>
          </GuideSection>

          <GuideSection
            id="task-inbox"
            title="Task inbox"
            intro="Tasks are concrete work items, often spawned from playbooks. The inbox surfaces them across every case."
          >
            <GuideSteps
              steps={[
                <>
                  Open <LinkText href="/tasks">Tasks</LinkText>. Overdue items
                  rise first, then due within 24 hours.
                </>,
                <>
                  Filter by status, due window, and assignee (mine, unassigned,
                  or a teammate). Mark done when the work is complete so SLA and
                  playbook cadence stay accurate.
                </>,
                <>
                  If a task is blocked, record why on the case (comment or
                  waiting reason) so the next person is not guessing.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="observables-and-iocs"
            title="Observables and IOCs"
            intro="Observables are facts on a case (IP, domain, hash, email, …). An IOC flag means the team treats that value as malicious for this investigation."
          >
            <GuideSteps
              steps={[
                <>
                  Add observables on the case. Prefer exact values; avoid
                  free-text dumps that cannot be matched later.
                </>,
                <>
                  Use{" "}
                  <LinkText href="/observables">Observable search</LinkText> to
                  see every case that shares a value — useful for campaign
                  clustering.
                </>,
                <>
                  Mark IOC only when evidence supports it. TLP on an observable
                  can be stricter than the case so sharing stays controlled.
                </>,
                <>
                  Enrichment (for example VirusTotal) may post findings as a
                  comment. Treat machine output as evidence to review, not an
                  automatic severity bump.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="tags-and-custom-fields"
            title="Tags and custom fields"
            intro="Tags support flexible grouping. Custom fields capture a named value that the team expects to use consistently."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <GuideChoice title="Use a tag when">
                The label is optional, changes over time, or helps search and
                group cases. Administrators maintain preferred labels in{" "}
                <LinkText href="/settings/tags">Team tags</LinkText>. Analysts
                can still create a tag while opening a case.
              </GuideChoice>
              <GuideChoice title="Use a custom field when">
                Every case should expose the same named value, such as business
                unit, external ticket ID, or affected service. Configure field
                type, options, required state, and visibility in{" "}
                <LinkText href="/settings/fields">Custom fields</LinkText>.
              </GuideChoice>
            </div>
            <p className="mt-4 text-sm text-slate-400">
              Deactivate an old field to preserve existing case data without
              showing it on new work. Deleting a definition should be reserved
              for fields whose values are no longer needed.
            </p>
          </GuideSection>

          <GuideSection
            id="threat-intelligence"
            title="Threat intelligence"
            intro="Brolga holds active threat intelligence. Kelpie shows live store stats and enriches cases with context packs. A match is context, not a verdict."
          >
            <GuideSteps
              steps={[
                <>
                  Administrators connect Brolga under{" "}
                  <LinkText href="/settings/integrations">
                    Integrations
                  </LinkText>
                  . OpenCTI and other upstreams feed Brolga; Kelpie does not
                  poll external TI lists.
                </>,
                <>
                  Open{" "}
                  <LinkText href="/ti">Threat intel</LinkText> for live entity,
                  claim, source, and quarantine counts from Brolga.
                </>,
                <>
                  Treat enrichment matches as context. Validate before changing
                  case severity, scope, or response actions.
                </>,
                <>
                  <strong className="font-medium text-slate-200">Brolga</strong>{" "}
                  is the central TI context engine. Configure it under
                  Integrations; Kelpie requests compact context packs for
                  observables rather than re-ingesting every upstream. See{" "}
                  <code className="text-xs text-slate-200">
                    docs/brolga-integration.md
                  </code>{" "}
                  in the repository for the HTTP contract.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="cyber-brief-and-landscape"
            title="Cyber brief and landscape"
            intro="Situational awareness for the team — not a substitute for your own case queue."
          >
            <GuideSteps
              steps={[
                <>
                  <LinkText href="/briefing">Cyber brief</LinkText> aggregates
                  news and reports. Filter by source and watched vendors; mark
                  vendors you care about so matches highlight.
                </>,
                <>
                  <LinkText href="/threat-landscape">Threat landscape</LinkText>{" "}
                  shows near-real-time attack activity from configured sources
                  (for example Cloudflare Radar when a token is set).
                </>,
                <>
                  Use these pages to brief the team or explain prioritisation —
                  open or link a case when something becomes your org&rsquo;s
                  problem.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="integrations-and-enrichment"
            title="Integrations and enrichment"
            intro="Integrations connect external intelligence, case sources, outbound notifications, and response systems."
          >
            <GuideSteps
              steps={[
                <>
                  Add credentials in{" "}
                  <LinkText href="/settings/integrations">
                    Settings, Integrations
                  </LinkText>
                  . Secrets are configured per organisation.
                </>,
                <>
                  Configure VirusTotal or another intelligence provider to
                  enrich observables found on a new case. Machine-produced
                  findings are added as a comment so analysts can review the
                  evidence and provenance.
                </>,
                <>
                  Configure email, Slack, or Microsoft Teams for case
                  notifications. Case-source integrations can pull work from
                  supported security platforms into the same workflow.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="automation-jobs"
            title="Automation jobs"
            intro="Scheduled work runs through the separate jobs worker so polling and enrichment survive web-process restarts."
          >
            <p className="text-sm leading-6 text-slate-300">
              Administrators set schedules in{" "}
              <LinkText href="/settings/integrations">Integrations</LinkText>{" "}
              and automation rules under{" "}
              <LinkText href="/settings/automations">Automations</LinkText>.
              Choose a polling interval that respects source rate limits and
              the freshness your team needs. Check the last-run result before
              shortening a schedule, especially for large feeds.
            </p>
          </GuideSection>

          <GuideSection
            id="attack-coverage"
            title="ATT&CK coverage"
            intro="Map techniques to cases so you can see what you actually investigate, not only what a detection product claims."
          >
            <GuideSteps
              steps={[
                <>
                  On a case, attach MITRE ATT&CK techniques that fit the
                  evidence. Prefer precision over dumping a whole tactic.
                </>,
                <>
                  Review{" "}
                  <LinkText href="/attack-coverage">ATT&CK coverage</LinkText>{" "}
                  to spot repeated techniques and blank spots in your response
                  history.
                </>,
                <>
                  Use gaps to drive detection engineering and playbook work —
                  not as a scoreboard.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="asset-context"
            title="Assets and identities"
            intro="Business context changes severity. A workstation and a payment host are not the same blast radius."
          >
            <GuideSteps
              steps={[
                <>
                  Import or maintain assets and identities under{" "}
                  <LinkText href="/asset-context">Assets & identities</LinkText>
                  .
                </>,
                <>
                  Keep owners and criticality current so case priority and
                  routing reflect real risk.
                </>,
                <>
                  Administrators control import and scoring settings under{" "}
                  <LinkText href="/settings/asset-context">
                    Settings, Asset context
                  </LinkText>
                  .
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="settings-and-roles"
            title="Settings and roles"
            intro="Roles gate who can change organisation shape versus who can work cases."
          >
            <div className="grid gap-5 sm:grid-cols-3">
              <GuideChoice title="Admin">
                Configure the organisation: team, SLA, SSO, integrations,
                tokens, custom fields, queues, and most settings. Also performs
                analyst work.
              </GuideChoice>
              <GuideChoice title="Analyst">
                Triage, comment, update cases, run allowed response actions, and
                use operational features. Cannot change org-wide configuration.
              </GuideChoice>
              <GuideChoice title="Read only">
                Inspect data without mutating state. Useful for stakeholders who
                need visibility without write access.
              </GuideChoice>
            </div>
            <GuideSteps
              steps={[
                <>
                  Set SLA targets per severity under{" "}
                  <LinkText href="/settings">Settings</LinkText> so dashboard
                  breach counts match your policy.
                </>,
                <>
                  Invite teammates and set roles carefully. Prefer least
                  privilege for service accounts via API scopes, not a shared
                  admin browser login.
                </>,
                <>
                  Review{" "}
                  <LinkText href="/settings/audit">Audit</LinkText> when
                  investigating who changed what.
                </>,
              ]}
            />
          </GuideSection>

          <GuideSection
            id="api-and-mcp"
            title="API and MCP"
            intro="Use scoped API tokens for services and agents. Give each consumer only the permissions and lifetime it needs."
          >
            <div className="space-y-4 text-sm leading-6 text-slate-300">
              <p>
                Administrators create tokens under{" "}
                <LinkText href="/settings">Settings, API tokens</LinkText>.
                For agents, use{" "}
                <LinkText href="/settings#mcp-agent-setup">
                  Settings, MCP agent setup
                </LinkText>{" "}
                for a copyable Streamable HTTP endpoint, least-privilege scopes,
                client config, and AGENTS.md block. REST endpoints are available
                below <code className="text-xs text-slate-200">/api/v1</code>.
                MCP is available at{" "}
                <code className="text-xs text-slate-200">/api/mcp</code>.
              </p>
              <pre className="kelpie-scroll-x rounded-lg bg-[color:var(--color-navy-900)] p-4 text-xs text-slate-300">
{`GET /api/v1/threat-intelligence?minConfidence=75&limit=100&offset=0
Authorization: Bearer klp_xxxxxxxx`}
              </pre>
              <p className="text-slate-400">
                Pagination responses include the total, current offset, limit,
                and next offset so consumers can walk large datasets safely.
              </p>
            </div>
          </GuideSection>

          <GuideSection
            id="playbooks-and-agents"
            title="Playbooks and agents (LLM.txt)"
            intro="A baseline catalogue of common SOC scenarios ships with Kelpie. Agents can discover it read-only over MCP or REST, and a copyable prompt tells them how to use it safely."
          >
            <div className="space-y-4 text-sm leading-6 text-slate-300">
              <p>
                Browse and filter the catalogue under{" "}
                <LinkText href="/playbooks">Playbooks</LinkText>. Baseline
                playbooks are labelled <em>Baseline v{"{n}"}</em>; anything
                your team authors is labelled <em>Custom</em>. Adding new
                scenarios to a future Kelpie release never overwrites an
                existing playbook or a local edit — an administrator can pull
                in newly-added baseline scenarios at any time from the
                Playbooks page without touching what is already there.
              </p>
              <p>
                Agents with a token scoped to{" "}
                <code className="text-xs text-slate-200">playbooks:read</code>{" "}
                can call the MCP tools{" "}
                <code className="text-xs text-slate-200">playbooks_list</code>{" "}
                and{" "}
                <code className="text-xs text-slate-200">playbooks_get</code>,
                or the REST endpoints{" "}
                <code className="text-xs text-slate-200">
                  GET /api/v1/playbooks
                </code>{" "}
                and{" "}
                <code className="text-xs text-slate-200">
                  GET /api/v1/playbooks/{"{id}"}
                </code>
                . All three are read-only.
              </p>
              <p>
                The prompt below is also published at{" "}
                <code className="text-xs text-slate-200">LLM.txt</code> in the
                Kelpie repository. Paste it into an agent&rsquo;s system/developer
                prompt and replace the placeholders with real values before
                use.
              </p>
              <div className="flex justify-end">
                <CopyTextButton text={LLM_AGENT_PROMPT} label="LLM.txt prompt" />
              </div>
              <pre className="kelpie-scroll-x max-h-96 overflow-y-auto rounded-lg bg-[color:var(--color-navy-900)] p-4 text-xs text-slate-300 whitespace-pre-wrap">
                {LLM_AGENT_PROMPT}
              </pre>
            </div>
          </GuideSection>
        </div>
      </div>
    </div>
  );
}

function GuideSection({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 py-8 first:pt-0">
      <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{intro}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function GuideSteps({ steps }: { steps: React.ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => (
        <li key={index} className="flex gap-3 text-sm leading-6 text-slate-300">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--color-navy-800)] text-xs font-semibold text-[color:var(--color-tan-300)]">
            {index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function GuideChoice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l-2 border-[color:var(--color-tan-500)] pl-4">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-400">{children}</p>
    </div>
  );
}

function GuideNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-md border border-[color:var(--color-navy-700)] bg-[color:var(--color-navy-900)] px-3 py-2 text-xs leading-5 text-slate-400">
      {children}
    </p>
  );
}

function LinkText({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-[color:var(--color-tan-300)] hover:underline"
    >
      {children}
    </Link>
  );
}
