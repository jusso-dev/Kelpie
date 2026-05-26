import Link from "next/link";
import { db } from "@/db";
import { responseActions, siemConnectors } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { connectorKinds } from "@/actions/connectors";
import { availableActionKinds } from "@/actions/response-actions";
import ConnectorSettings from "@/components/connector-settings";
import ResponseActionSettings from "@/components/response-action-settings";

export default async function IntegrationsSettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [connectors, actions, kinds, actionKinds] = await Promise.all([
    db
      .select()
      .from(siemConnectors)
      .where(eq(siemConnectors.organisationId, user.organisationId))
      .orderBy(desc(siemConnectors.createdAt)),
    db
      .select()
      .from(responseActions)
      .where(eq(responseActions.organisationId, user.organisationId))
      .orderBy(desc(responseActions.createdAt)),
    connectorKinds(),
    availableActionKinds(),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Integrations</h1>
        <p className="text-sm text-slate-400">
          SIEM connectors and SOAR-style response actions.
        </p>
      </header>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-1">SIEM connectors</h2>
        <p className="text-xs text-slate-500 mb-3">
          Poll Splunk, Elastic, or Sentinel on a schedule and turn results into
          alerts. A credential error halts polling until cleared.
        </p>
        <ConnectorSettings
          connectors={connectors.map((c) => ({
            id: c.id,
            kind: c.kind,
            name: c.name,
            isActive: c.isActive,
            lastPolledAt: c.lastPolledAt ? c.lastPolledAt.toISOString() : null,
            lastError: c.lastError,
            alertsProduced: c.alertsProduced,
          }))}
          kinds={kinds}
          isAdmin={isAdmin}
        />
      </section>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-1">Response actions</h2>
        <p className="text-xs text-slate-500 mb-3">
          Bounded actions an analyst can run from a case (block an IP, disable a
          user, isolate a host). Every run is audit-logged on the case timeline.
        </p>
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
