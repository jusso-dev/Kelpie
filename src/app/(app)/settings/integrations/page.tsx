import Link from "next/link";
import { db } from "@/db";
import { caseSources, responseActions } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { availableActionKinds } from "@/actions/response-actions";
import ResponseActionSettings from "@/components/response-action-settings";
import CaseSourceSettings from "@/components/case-source-settings";

export default async function IntegrationsSettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [sources, actions, actionKinds] = await Promise.all([
    db
      .select({
        id: caseSources.id,
        name: caseSources.name,
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
      .select()
      .from(responseActions)
      .where(eq(responseActions.organisationId, user.organisationId))
      .orderBy(desc(responseActions.createdAt)),
    availableActionKinds(),
  ]);

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Integrations</h1>
        <p className="text-sm text-slate-400">
          Import external cases and configure response automation.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Case sources</h2>
          <p>
            Import Microsoft Sentinel incidents directly as Kelpie cases.
            Source references prevent duplicates on later polls.
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
