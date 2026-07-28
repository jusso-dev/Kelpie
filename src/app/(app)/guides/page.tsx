import Link from "next/link";
import CopyTextButton from "@/components/copy-text-button";
import { LLM_AGENT_PROMPT } from "@/lib/llm-prompt";

const guideLinks = [
  ["cases-and-templates", "Cases and templates"],
  ["tags-and-custom-fields", "Tags and custom fields"],
  ["threat-intelligence", "Threat intelligence"],
  ["integrations-and-enrichment", "Integrations and enrichment"],
  ["automation-jobs", "Automation jobs"],
  ["api-and-mcp", "API and MCP"],
  ["playbooks-and-agents", "Playbooks and agents (LLM.txt)"],
] as const;

export default function GuidesPage() {
  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <h1>Guides</h1>
        <p>
          Practical setup and operating notes for the features that need more
          than a button label.
        </p>
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
            id="cases-and-templates"
            title="Cases and templates"
            intro="A case is the durable record for an investigation. Start with facts, then add tasks, comments, observables, evidence, and ownership as work progresses."
          >
            <GuideSteps
              steps={[
                <>
                  Open <LinkText href="/cases/new">New case</LinkText> and record
                  a clear title, factual summary, severity, and handling
                  markings.
                </>,
                <>
                  Use <LinkText href="/playbooks">Playbooks</LinkText> for
                  repeatable response work. Use case templates when the same
                  initial fields and structure recur.
                </>,
                <>
                  Keep one investigation per case. Use consistent tags and
                  comments to record related activity without combining
                  unrelated work into one timeline.
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
            intro="Threat feeds provide context, not a verdict. Confidence is the source score and should be considered alongside recency, feed reputation, and case evidence."
          >
            <GuideSteps
              steps={[
                <>
                  Administrators choose and maintain sources in{" "}
                  <LinkText href="/settings/integrations">
                    Integrations
                  </LinkText>
                  . Load the supplied defaults only when they match your
                  operating needs.
                </>,
                <>
                  Search the <LinkText href="/ti">Threat intel</LinkText> store
                  by value, type, feed, tag, or minimum confidence. Results are
                  paginated so large feeds remain usable.
                </>,
                <>
                  Treat a match as enrichment. Validate it before changing case
                  severity, scope, or response actions.
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
              <LinkText href="/settings/integrations">Integrations</LinkText>.
              Choose a polling interval that respects source rate limits and
              the freshness your team needs. Check the last-run result before
              shortening a schedule, especially for large feeds.
            </p>
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
                REST endpoints are available below{" "}
                <code className="text-xs text-slate-200">/api/v1</code>. MCP is
                available at{" "}
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
