import Link from "next/link";
import { db } from "@/db";
import { caseTemplates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { listClosurePoliciesCore } from "@/lib/closure/policy-core";
import ClosurePolicySettings from "@/components/closure-policy-settings";

export default async function ClosurePoliciesSettingsPage() {
  const user = await requireRole(["admin"]);
  const [policies, templates] = await Promise.all([
    listClosurePoliciesCore(user.organisationId),
    db
      .select({ id: caseTemplates.id, name: caseTemplates.name })
      .from(caseTemplates)
      .where(eq(caseTemplates.organisationId, user.organisationId)),
  ]);

  return (
    <div className="kelpie-page max-w-6xl">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="mt-1">Case closure policies</h1>
        <p>
          Versioned requirements evaluated when a case is closed. UI, REST, and
          automation share the same validator. Edits create a new version so
          historical closures keep the rules they were closed under.
        </p>
      </header>

      <section className="kelpie-section">
        <ClosurePolicySettings
          policies={policies.map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
            templateId: p.templateId,
            isDefault: p.isDefault,
            isActive: p.isActive,
            currentVersion: p.currentVersion,
            requirements: p.requirements,
            requireTwoPersonOverride: p.requireTwoPersonOverride,
          }))}
          templates={templates}
        />
      </section>
    </div>
  );
}
