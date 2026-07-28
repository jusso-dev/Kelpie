import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { listEscalationPoliciesCore } from "@/lib/escalation-core";
import { listQueuesCore } from "@/lib/queues-core";
import { EscalationPolicySettings } from "@/components/escalation-policy-settings";

export default async function EscalationPoliciesPage() {
  const user = await requireRole(["admin"]);
  const [policies, queues, orgUsers] = await Promise.all([
    listEscalationPoliciesCore(user.organisationId),
    listQueuesCore(user.organisationId),
    db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.organisationId, user.organisationId))
      .orderBy(asc(users.name)),
  ]);

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="mt-1">Escalation policies</h1>
        <p>
          Escalation policies can notify, reassign, or raise severity. They can
          never run a destructive response action -- there is no field for
          one. Every edit is versioned, and a policy always starts disabled.
        </p>
      </header>

      <section className="kelpie-section">
        <EscalationPolicySettings
          policies={policies.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            revision: p.revision,
            isActive: p.isActive,
            queueId: p.queueId,
            conditions: p.conditions as {
              minAgeMinutes?: number;
              minUnacknowledgedMinutes?: number;
              severities?: string[];
              waitingReason?: "third_party" | "approval";
            },
            notifyEnabled: p.notifyEnabled,
            notifyTargets: p.notifyTargets as string[],
            reassignEnabled: p.reassignEnabled,
            reassignToQueueId: p.reassignToQueueId,
            reassignToUserId: p.reassignToUserId,
            raiseSeverityEnabled: p.raiseSeverityEnabled,
            raiseSeverityTo: p.raiseSeverityTo,
          }))}
          queues={queues.map((q) => ({ id: q.id, name: q.name, teamName: q.teamName }))}
          users={orgUsers}
        />
      </section>
    </div>
  );
}
