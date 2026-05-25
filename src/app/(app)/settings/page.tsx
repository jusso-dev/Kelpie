import { db } from "@/db";
import { apiTokens, slaPolicies, users, webhooks } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import TokenCreator from "@/components/token-creator";
import SlaSettings from "@/components/sla-settings";
import WebhookSettings from "@/components/webhook-settings";
import TokenList from "@/components/token-list";

export default async function SettingsPage() {
  const user = await requireUser();
  const [tokens, teamMembers, slaRows, webhookRows] = await Promise.all([
    db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.organisationId, user.organisationId))
      .orderBy(desc(apiTokens.createdAt)),
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
      .select()
      .from(slaPolicies)
      .where(eq(slaPolicies.organisationId, user.organisationId))
      .orderBy(asc(slaPolicies.severity)),
    db
      .select()
      .from(webhooks)
      .where(eq(webhooks.organisationId, user.organisationId))
      .orderBy(desc(webhooks.createdAt)),
  ]);
  const isAdmin = user.role === "admin";

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-400">
          Organisation: {user.organisationName}
        </p>
      </header>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-3">Team</h2>
        <div className="kelpie-scroll-x" tabIndex={0} aria-label="Team members table">
          <table className="kelpie-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {teamMembers.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="text-slate-400">{u.email}</td>
                  <td className="text-slate-300">{u.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-3">SLA policies</h2>
        <p className="text-xs text-slate-500 mb-3">
          One policy per severity. The breach checker uses these to flag the
          timeline and email the assignee when a target slips.
        </p>
        <SlaSettings
          policies={slaRows.map((p) => ({
            id: p.id,
            name: p.name,
            severity: p.severity,
            timeToAcknowledgeMinutes: p.timeToAcknowledgeMinutes,
            timeToContainMinutes: p.timeToContainMinutes,
            timeToResolveMinutes: p.timeToResolveMinutes,
          }))}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-3">API tokens</h2>
        {!isAdmin ? (
          <p className="text-xs text-slate-500">Only admins can manage tokens.</p>
        ) : (
          <TokenCreator />
        )}
        <TokenList
          tokens={tokens.map((t) => ({
            id: t.id,
            name: t.name,
            scopes: (t.scopes as string[]) ?? [],
            createdAt: t.createdAt.toISOString(),
            lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
            lastUsedIp: t.lastUsedIp,
            expiresAt: t.expiresAt ? t.expiresAt.toISOString() : null,
            deprecatedAt: t.deprecatedAt ? t.deprecatedAt.toISOString() : null,
          }))}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-3">Outbound webhooks</h2>
        <p className="text-xs text-slate-500 mb-3">
          POST a JSON event to your URL on case and alert activity. Signed with
          HMAC-SHA256 in the <code>X-Kelpie-Signature</code> header.
        </p>
        <WebhookSettings
          webhooks={webhookRows.map((w) => ({
            id: w.id,
            name: w.name,
            url: w.url,
            events: (w.events as string[]) ?? [],
            isActive: w.isActive,
            createdAt: w.createdAt.toISOString(),
          }))}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-card p-5 text-sm text-slate-300 space-y-2">
        <h2 className="text-sm font-medium text-slate-300">Sending alerts via API</h2>
        <p className="text-slate-400 text-xs">
          POST a JSON alert to the URL below with{" "}
          <code className="text-xs">Authorization: Bearer &lt;token&gt;</code>.
        </p>
        <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
{`POST /api/v1/alerts
Content-Type: application/json
Authorization: Bearer klp_xxxxxxxx

{
  "title": "Suspicious login from new geo",
  "description": "Auth log shows a successful login from a country we have never seen",
  "severity": "high",
  "source": "siem-splunk",
  "externalRef": "splunk-12345",
  "observables": [
    {"type": "ip", "value": "203.0.113.4"},
    {"type": "username", "value": "j.kim"}
  ],
  "rawPayload": {"...": "the full alert json"}
}`}
        </pre>
      </section>
    </div>
  );
}
