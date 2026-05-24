import { db } from "@/db";
import { apiTokens, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";
import { requireUser } from "@/lib/session";
import TokenCreator from "@/components/token-creator";

export default async function SettingsPage() {
  const user = await requireUser();
  const [tokens, teamMembers] = await Promise.all([
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
      </section>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-3">API tokens</h2>
        {!isAdmin ? (
          <p className="text-xs text-slate-500">Only admins can manage tokens.</p>
        ) : (
          <TokenCreator />
        )}
        <div className="mt-4">
          <table className="kelpie-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Scopes</th>
                <th>Created</th>
                <th>Last used</th>
              </tr>
            </thead>
            <tbody>
              {tokens.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-slate-500 py-6">
                    No tokens.
                  </td>
                </tr>
              ) : (
                tokens.map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className="text-xs text-slate-400 font-mono">
                      {(t.scopes as string[])?.join(", ") || "(any)"}
                    </td>
                    <td className="text-xs text-slate-500">
                      {format(t.createdAt, "PP")}
                    </td>
                    <td className="text-xs text-slate-500">
                      {t.lastUsedAt ? format(t.lastUsedAt, "PP p") : "Never"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="kelpie-card p-5 text-sm text-slate-300 space-y-2">
        <h2 className="text-sm font-medium text-slate-300">Sending alerts via API</h2>
        <p className="text-slate-400 text-xs">
          POST a JSON alert to the URL below with{" "}
          <code className="text-xs">Authorization: Bearer &lt;token&gt;</code>.
        </p>
        <pre className="text-xs bg-[color:var(--color-navy-800)] p-3 rounded">
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
