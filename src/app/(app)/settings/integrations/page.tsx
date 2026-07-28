import Link from "next/link";
import { db } from "@/db";
import {
  caseSources,
  cases,
  inboundSourceStatus,
  mailboxConnections,
  responseActions,
  tiFeeds,
  webhooks,
} from "@/db/schema";
import { and, count, desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { availableActionKinds } from "@/actions/response-actions";
import ResponseActionSettings from "@/components/response-action-settings";
import CaseSourceSettings from "@/components/case-source-settings";
import MailboxSettings from "@/components/mailbox-settings";
import AutomationSchedules from "@/components/automation-schedules";
import VirusTotalSettings from "@/components/virustotal-settings";
import WebhookSettings from "@/components/webhook-settings";
import TawnySettings from "@/components/tawny-settings";
import { getVirusTotalConfiguration } from "@/lib/enrichment/providers/virustotal";
import { TAWNY_SOURCE_SYSTEM } from "@/lib/case-source-identity";
import { publicMailboxConnection } from "@/lib/mailbox/core";
import { Globe2 } from "lucide-react";

export default async function IntegrationsSettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [
    sources,
    feeds,
    actions,
    actionKinds,
    webhookRows,
    virusTotal,
    tawnyStatusRows,
    tawnyCaseCountRows,
    mailboxRows,
  ] = await Promise.all([
    db
      .select({
        id: caseSources.id,
        name: caseSources.name,
        kind: caseSources.kind,
        isActive: caseSources.isActive,
        pollIntervalMinutes: caseSources.pollIntervalMinutes,
        lastPolledAt: caseSources.lastPolledAt,
        lastError: caseSources.lastError,
        importedCaseCount: caseSources.importedCaseCount,
      })
      .from(caseSources)
      .where(eq(caseSources.organisationId, user.organisationId))
      .orderBy(desc(caseSources.createdAt)),
    db
      .select({
        id: tiFeeds.id,
        name: tiFeeds.name,
        isActive: tiFeeds.isActive,
        pollIntervalMinutes: tiFeeds.pollIntervalMinutes,
        lastPolledAt: tiFeeds.lastPolledAt,
        lastError: tiFeeds.lastError,
      })
      .from(tiFeeds)
      .where(eq(tiFeeds.organisationId, user.organisationId))
      .orderBy(desc(tiFeeds.createdAt)),
    db
      .select()
      .from(responseActions)
      .where(eq(responseActions.organisationId, user.organisationId))
      .orderBy(desc(responseActions.createdAt)),
    availableActionKinds(),
    db
      .select()
      .from(webhooks)
      .where(eq(webhooks.organisationId, user.organisationId))
      .orderBy(desc(webhooks.createdAt)),
    getVirusTotalConfiguration(user.organisationId),
    db
      .select()
      .from(inboundSourceStatus)
      .where(
        and(
          eq(inboundSourceStatus.organisationId, user.organisationId),
          eq(inboundSourceStatus.sourceSystem, TAWNY_SOURCE_SYSTEM),
        ),
      )
      .limit(1),
    db
      .select({ total: count() })
      .from(cases)
      .where(
        and(
          eq(cases.organisationId, user.organisationId),
          eq(cases.sourceSystem, TAWNY_SOURCE_SYSTEM),
        ),
      ),
    db
      .select()
      .from(mailboxConnections)
      .where(eq(mailboxConnections.organisationId, user.organisationId))
      .orderBy(desc(mailboxConnections.createdAt)),
  ]);
  const tawnyStatus = tawnyStatusRows[0] ?? null;
  const tawnyImportedCaseCount = Number(tawnyCaseCountRows[0]?.total ?? 0);
  // No dedicated absolute-URL helper exists in the repo (grepped for
  // `x-forwarded-proto` / `absoluteUrl`); other server code builds links from
  // `process.env.APP_URL` (see src/lib/webhooks.ts, src/lib/sso/config.ts), so
  // the Tawny endpoint follows the same established pattern.
  const appOrigin = (process.env.APP_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const tawnyEndpoint = `${appOrigin}/api/v1/cases`;

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Integrations</h1>
        <p className="text-sm text-slate-400">
          Connect case sources, intelligence, notifications, and bounded automation.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Case sources</h2>
          <p>
            Import Microsoft Sentinel or Defender XDR incidents directly as
            Kelpie cases. Source references prevent duplicates on later polls.
          </p>
        </div>
        <CaseSourceSettings
          sources={sources.map((source) => ({
            ...source,
            lastPolledAt: source.lastPolledAt?.toISOString() ?? null,
          }))}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Inbound mailbox</h2>
          <p>
            Poll IMAP over TLS or Microsoft Graph mailboxes. Credentials are
            encrypted at rest and never shown after save. Attachments use the
            evidence pipeline; messages can auto-create cases or wait for review.
          </p>
        </div>
        <MailboxSettings
          connections={mailboxRows.map((row) => {
            const pub = publicMailboxConnection(row);
            return {
              id: pub.id,
              name: pub.name,
              provider: pub.provider,
              folder: pub.folder,
              pollIntervalMinutes: pub.pollIntervalMinutes,
              intakeMode: pub.intakeMode,
              isActive: pub.isActive,
              lastPolledAt: pub.lastPolledAt?.toISOString() ?? null,
              lastSuccessAt: pub.lastSuccessAt?.toISOString() ?? null,
              lastError: pub.lastError,
              importedMessageCount: pub.importedMessageCount,
              connectionMeta: (pub.connectionMeta ?? {}) as Record<
                string,
                unknown
              >,
              hasCredentials: pub.hasCredentials,
            };
          })}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Tawny</h2>
          <p>
            Tawny pushes alerts to Kelpie as cases rather than being polled.
            Give it a <code className="text-xs">cases:write</code>-scoped
            token and the endpoint below.
          </p>
        </div>
        <TawnySettings
          endpoint={tawnyEndpoint}
          status={
            tawnyStatus
              ? {
                  lastDeliveryAt: tawnyStatus.lastDeliveryAt,
                  lastCaseCreatedAt: tawnyStatus.lastCaseCreatedAt,
                  lastErrorAt: tawnyStatus.lastErrorAt,
                  lastErrorMessage: tawnyStatus.lastErrorMessage,
                  lastErrorStatus: tawnyStatus.lastErrorStatus,
                  deliveryCount: tawnyStatus.deliveryCount,
                  createdCaseCount: tawnyStatus.createdCaseCount,
                  duplicateCount: tawnyStatus.duplicateCount,
                  errorCount: tawnyStatus.errorCount,
                }
              : null
          }
          importedCaseCount={tawnyImportedCaseCount}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Notification channels</h2>
          <p>
            Send case activity to Slack, Microsoft Teams, or an HMAC-signed
            webhook.
          </p>
        </div>
        <WebhookSettings
          webhooks={webhookRows.map((webhook) => ({
            id: webhook.id,
            name: webhook.name,
            kind: webhook.kind,
            url: webhook.url,
            events: (webhook.events as string[]) ?? [],
            isActive: webhook.isActive,
            createdAt: webhook.createdAt.toISOString(),
          }))}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Observable enrichment</h2>
          <p>
            Enrich technical evidence as analysts add it to a case.
          </p>
        </div>
        <VirusTotalSettings configuration={virusTotal} isAdmin={isAdmin} />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Automation schedules</h2>
          <p>
            Control how often the Redis-backed BullMQ worker polls approved TI
            feeds and case sources. Changes are applied within one minute.
          </p>
        </div>
        <AutomationSchedules
          canEdit={isAdmin}
          jobs={[
            ...feeds.map((feed) => ({
              id: feed.id,
              kind: "threat_intelligence" as const,
              name: feed.name,
              intervalMinutes: feed.pollIntervalMinutes,
              isActive: feed.isActive,
              lastRunAt: feed.lastPolledAt?.toISOString() ?? null,
              lastError: feed.lastError,
            })),
            ...sources.map((source) => ({
              id: source.id,
              kind: "case_source" as const,
              name: source.name,
              intervalMinutes: source.pollIntervalMinutes,
              isActive: source.isActive,
              lastRunAt: source.lastPolledAt?.toISOString() ?? null,
              lastError: source.lastError,
            })),
          ]}
        />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Global threat activity</h2>
          <p>
            The threat landscape uses Cloudflare Radar application-attack
            telemetry.
          </p>
        </div>
        <div className="flex flex-col gap-4 rounded-lg border border-[color:var(--color-navy-700)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Globe2
              size={20}
              className="mt-0.5 shrink-0 text-[color:var(--color-tan-400)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-sm font-medium text-slate-200">
                Cloudflare Radar
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {process.env.CLOUDFLARE_RADAR_API_TOKEN
                  ? "Connected through the container environment."
                  : "Set CLOUDFLARE_RADAR_API_TOKEN on the app container with Account Radar Read permission."}
              </p>
            </div>
          </div>
          <span
            className={
              "kelpie-badge " +
              (process.env.CLOUDFLARE_RADAR_API_TOKEN
                ? "text-green-400"
                : "text-amber-400")
            }
          >
            {process.env.CLOUDFLARE_RADAR_API_TOKEN ? "connected" : "not configured"}
          </span>
        </div>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
        <h2 className="text-sm font-medium text-slate-300 mb-1">Response actions</h2>
        <p>
          Bounded actions an analyst can run from a case (block an IP, disable a
          user, isolate a host). Every run is audit-logged on the case timeline.
        </p>
        </div>
        <ResponseActionSettings
          actions={actions.map((a) => ({
            id: a.id,
            kind: a.kind,
            name: a.name,
            isActive: a.isActive,
          }))}
          kinds={actionKinds}
          isAdmin={isAdmin}
        />
      </section>
    </div>
  );
}
