import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { automationRules } from "@/db/schema";
import { requireUser } from "@/lib/session";
import AutomationRuleSettings from "@/components/automation-rule-settings";

export default async function AutomationSettingsPage() {
  const user = await requireUser();
  const rules = await db
    .select()
    .from(automationRules)
    .where(eq(automationRules.organisationId, user.organisationId))
    .orderBy(desc(automationRules.createdAt));
  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="mt-1">Agent automations</h1>
        <p>
          Trigger governed Muster agent handoffs from case events without a workflow canvas.
        </p>
      </header>
      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Event rules</h2>
          <p>
            Fixed triggers, allowlisted conditions, signed delivery, retries, and immutable run records.
          </p>
        </div>
        <AutomationRuleSettings
          rules={rules.map((rule) => ({
            id: rule.id,
            name: rule.name,
            triggerEvent: rule.triggerEvent,
            conditions: rule.conditions,
            targetProfile: rule.targetProfile,
            keyId: rule.keyId,
            isActive: rule.isActive,
            revision: rule.revision,
          }))}
          isAdmin={user.role === "admin"}
        />
      </section>
    </div>
  );
}
