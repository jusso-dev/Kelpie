import { db } from "@/db";
import { apiTokens, slaPolicies, users } from "@/db/schema";
import Link from "next/link";
import { eq, desc, asc } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import TokenCreator from "@/components/token-creator";
import SlaSettings from "@/components/sla-settings";
import TokenList from "@/components/token-list";
import TeamManagement from "@/components/team-management";

export default async function SettingsPage() {
  const user = await requireUser();
  const [tokens, teamMembers, slaRows] = await Promise.all([
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
        banned: users.banned,
        banReason: users.banReason,
        passwordResetRequired: users.passwordResetRequired,
        mfaRequired: users.mfaRequired,
        twoFactorEnabled: users.twoFactorEnabled,
        invitedAt: users.invitedAt,
        lastPasswordResetAt: users.lastPasswordResetAt,
      })
      .from(users)
      .where(eq(users.organisationId, user.organisationId)),
    db
      .select()
      .from(slaPolicies)
      .where(eq(slaPolicies.organisationId, user.organisationId))
      .orderBy(asc(slaPolicies.severity)),
  ]);
  const isAdmin = user.role === "admin";

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <h1>Settings</h1>
        <p>
          Organisation: {user.organisationName}
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>More configuration</h2>
          <p>Identity, integrations, and organisation data structure.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href="/settings/integrations"
            className="kelpie-btn kelpie-btn-secondary justify-center"
          >
            Integrations
          </Link>
          <Link
            href="/settings/automations"
            className="kelpie-btn kelpie-btn-secondary justify-center"
          >
            Agent automations
          </Link>
          <Link
            href="/settings/fields"
            className="kelpie-btn kelpie-btn-secondary justify-center"
          >
            Custom fields
          </Link>
          <Link
            href="/settings/tags"
            className="kelpie-btn kelpie-btn-secondary justify-center"
          >
            Team tags
          </Link>
          <Link
            href="/settings/sso"
            className="kelpie-btn kelpie-btn-secondary justify-center"
          >
            Single sign-on
          </Link>
          <Link
            href="/settings/audit"
            className="kelpie-btn kelpie-btn-secondary justify-center"
          >
            Audit log
          </Link>
          <Link
            href="/settings/run-console"
            className="kelpie-btn kelpie-btn-secondary justify-center"
          >
            Run console
          </Link>
        </div>
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Team</h2>
          <p>Manage roles, access, passwords, and MFA requirements.</p>
        </div>
        <TeamManagement
          members={teamMembers.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            banned: u.banned,
            banReason: u.banReason,
            passwordResetRequired: u.passwordResetRequired,
            mfaRequired: u.mfaRequired,
            twoFactorEnabled: u.twoFactorEnabled,
            invitedAt: u.invitedAt ? u.invitedAt.toISOString() : null,
            lastPasswordResetAt: u.lastPasswordResetAt
              ? u.lastPasswordResetAt.toISOString()
              : null,
          }))}
          isAdmin={isAdmin}
          currentUserId={user.id}
        />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
        <h2>SLA policies</h2>
        <p>
          One policy per severity. The breach checker uses these to flag the
          timeline and email the assignee when a target slips.
        </p>
        </div>
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

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>API tokens</h2>
          <p>Create scoped credentials for case automation and integrations.</p>
        </div>
        {!isAdmin ? (
          <p className="text-xs text-slate-500">Only administrators can manage tokens.</p>
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

      <section className="kelpie-section text-sm text-slate-300">
        <div className="kelpie-section-header">
        <h2>Creating cases via API</h2>
        <p>
          POST a JSON case to the URL below with{" "}
          <code className="text-xs">Authorization: Bearer &lt;token&gt;</code>.
        </p>
        </div>
        <pre className="overflow-x-auto rounded bg-[color:var(--color-navy-800)] p-3 text-xs">
{`POST /api/v1/cases
Content-Type: application/json
Authorization: Bearer klp_xxxxxxxx

{
  "title": "Suspicious login investigation",
  "summary": "Auth logs show a successful login from an unusual location.",
  "severity": "high",
  "classification": "unauthorised_access",
  "tags": ["identity", "unusual-location"]
}`}
        </pre>
      </section>
    </div>
  );
}
