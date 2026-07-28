/**
 * CRUD for versioned case-closure policies (issue #57).
 *
 * Editing requirements always inserts a new immutable version row and bumps
 * `currentVersion`. Toggling `isActive` / renaming does not create a version.
 * There is no silent retroactive mutation path: open cases pick up the latest
 * version only on the next evaluation; closed snapshots keep the version id
 * they were evaluated against.
 */
import { db } from "@/db";
import {
  caseClosurePolicies,
  caseClosurePolicyVersions,
  caseTemplates,
  users,
} from "@/db/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import { newId } from "@/lib/utils";
import { recordAuditEvent } from "@/lib/audit/events";
import {
  CLOSURE_REQUIREMENT_TYPES,
  type ClosureRequirementConfig,
} from "./types";
import { parseRequirementConfigs } from "./evaluate";

export type ClosurePolicyInput = {
  name: string;
  description?: string | null;
  templateId?: string | null;
  isDefault?: boolean;
  requirements: ClosureRequirementConfig[];
  requireTwoPersonOverride?: boolean;
};

function validateRequirements(requirements: ClosureRequirementConfig[]): void {
  if (!Array.isArray(requirements)) {
    throw new Error("requirements must be an array");
  }
  for (const r of requirements) {
    if (!r || typeof r !== "object" || !("type" in r)) {
      throw new Error("Each requirement needs a type");
    }
    if (
      !(CLOSURE_REQUIREMENT_TYPES as readonly string[]).includes(
        (r as { type: string }).type,
      )
    ) {
      throw new Error(`Unknown requirement type: ${(r as { type: string }).type}`);
    }
  }
  // disposition is always enforced at close time via built-in minimum, but
  // policies may still list it explicitly. Empty policy is allowed (falls
  // through to only what the caller puts on the form).
}

async function assertTemplateInOrg(
  organisationId: string,
  templateId: string | null | undefined,
): Promise<void> {
  if (!templateId) return;
  const [tpl] = await db
    .select({ id: caseTemplates.id })
    .from(caseTemplates)
    .where(
      and(
        eq(caseTemplates.id, templateId),
        eq(caseTemplates.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!tpl) throw new Error("Template not found in this organisation");
}

export async function listClosurePoliciesCore(organisationId: string) {
  const policies = await db
    .select()
    .from(caseClosurePolicies)
    .where(eq(caseClosurePolicies.organisationId, organisationId))
    .orderBy(asc(caseClosurePolicies.name));

  const versions =
    policies.length === 0
      ? []
      : await db
          .select()
          .from(caseClosurePolicyVersions)
          .where(eq(caseClosurePolicyVersions.organisationId, organisationId))
          .orderBy(desc(caseClosurePolicyVersions.version));

  return policies.map((p) => {
    const current = versions.find(
      (v) => v.policyId === p.id && v.version === p.currentVersion,
    );
    return {
      ...p,
      requirements: current
        ? parseRequirementConfigs(current.requirements)
        : [],
      requireTwoPersonOverride: current?.requireTwoPersonOverride ?? false,
      versionId: current?.id ?? null,
    };
  });
}

export async function createClosurePolicyCore(
  organisationId: string,
  actorId: string | null,
  input: ClosurePolicyInput,
): Promise<{ id: string; versionId: string }> {
  if (!input.name.trim()) throw new Error("Policy name is required");
  validateRequirements(input.requirements);
  await assertTemplateInOrg(organisationId, input.templateId);

  const isDefault = input.isDefault === true && !input.templateId;
  if (input.templateId && input.isDefault) {
    throw new Error("Template-scoped policies cannot be the organisation default");
  }

  if (isDefault) {
    // Only one active default; deactivate prior defaults without versioning.
    await db
      .update(caseClosurePolicies)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(caseClosurePolicies.organisationId, organisationId),
          eq(caseClosurePolicies.isDefault, true),
        ),
      );
  }

  const policyId = newId("ccp");
  const versionId = newId("ccpv");
  await db.insert(caseClosurePolicies).values({
    id: policyId,
    organisationId,
    name: input.name.trim(),
    description: input.description?.trim() || null,
    templateId: input.templateId ?? null,
    isDefault,
    isActive: true,
    currentVersion: 1,
    createdBy: actorId,
  });
  await db.insert(caseClosurePolicyVersions).values({
    id: versionId,
    policyId,
    organisationId,
    version: 1,
    requirements: input.requirements,
    requireTwoPersonOverride: input.requireTwoPersonOverride === true,
    createdBy: actorId,
  });

  await recordAuditEvent({
    organisationId,
    actorId,
    actorType: actorId ? "user" : "system",
    action: "case_closure_policy.created",
    targetType: "case_closure_policy",
    targetId: policyId,
    targetLabel: input.name.trim(),
    after: {
      version: 1,
      requirements: input.requirements,
      templateId: input.templateId ?? null,
      isDefault,
    },
  });

  return { id: policyId, versionId };
}

/**
 * Behavioural edit: always creates a new version. Does not mutate historical
 * version rows. Name/description/isDefault changes that don't touch
 * requirements still bump a version when requirements are re-supplied; call
 * `setClosurePolicyActiveCore` for enable/disable without versioning.
 */
export async function updateClosurePolicyCore(
  organisationId: string,
  actorId: string | null,
  policyId: string,
  input: ClosurePolicyInput,
): Promise<{ version: number; versionId: string }> {
  if (!input.name.trim()) throw new Error("Policy name is required");
  validateRequirements(input.requirements);

  const [existing] = await db
    .select()
    .from(caseClosurePolicies)
    .where(
      and(
        eq(caseClosurePolicies.id, policyId),
        eq(caseClosurePolicies.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Policy not found");

  // templateId is immutable after create so historical applicability stays clear.
  if (
    input.templateId !== undefined &&
    (input.templateId ?? null) !== (existing.templateId ?? null)
  ) {
    throw new Error(
      "Policy template scope cannot be changed; create a new policy instead",
    );
  }

  const isDefault =
    existing.templateId == null && input.isDefault === true
      ? true
      : existing.templateId == null
        ? input.isDefault === true
        : false;

  if (isDefault && !existing.isDefault) {
    await db
      .update(caseClosurePolicies)
      .set({ isDefault: false, updatedAt: new Date() })
      .where(
        and(
          eq(caseClosurePolicies.organisationId, organisationId),
          eq(caseClosurePolicies.isDefault, true),
        ),
      );
  }

  const nextVersion = existing.currentVersion + 1;
  const versionId = newId("ccpv");
  await db.insert(caseClosurePolicyVersions).values({
    id: versionId,
    policyId,
    organisationId,
    version: nextVersion,
    requirements: input.requirements,
    requireTwoPersonOverride: input.requireTwoPersonOverride === true,
    createdBy: actorId,
  });

  await db
    .update(caseClosurePolicies)
    .set({
      name: input.name.trim(),
      description: input.description?.trim() || null,
      isDefault: existing.templateId == null ? Boolean(input.isDefault) : false,
      currentVersion: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(caseClosurePolicies.id, policyId));

  await recordAuditEvent({
    organisationId,
    actorId,
    actorType: actorId ? "user" : "system",
    action: "case_closure_policy.versioned",
    targetType: "case_closure_policy",
    targetId: policyId,
    targetLabel: input.name.trim(),
    metadata: {
      previousVersion: existing.currentVersion,
      version: nextVersion,
      requirements: input.requirements,
    },
  });

  return { version: nextVersion, versionId };
}

export async function setClosurePolicyActiveCore(
  organisationId: string,
  actorId: string | null,
  policyId: string,
  isActive: boolean,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(caseClosurePolicies)
    .where(
      and(
        eq(caseClosurePolicies.id, policyId),
        eq(caseClosurePolicies.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Policy not found");
  if (existing.isActive === isActive) return;

  await db
    .update(caseClosurePolicies)
    .set({ isActive, updatedAt: new Date() })
    .where(eq(caseClosurePolicies.id, policyId));

  await recordAuditEvent({
    organisationId,
    actorId,
    actorType: actorId ? "user" : "system",
    action: isActive
      ? "case_closure_policy.activated"
      : "case_closure_policy.deactivated",
    targetType: "case_closure_policy",
    targetId: policyId,
    targetLabel: existing.name,
    metadata: { version: existing.currentVersion },
  });
}

export async function listPolicyVersionsCore(
  organisationId: string,
  policyId: string,
) {
  const [policy] = await db
    .select({ id: caseClosurePolicies.id })
    .from(caseClosurePolicies)
    .where(
      and(
        eq(caseClosurePolicies.id, policyId),
        eq(caseClosurePolicies.organisationId, organisationId),
      ),
    )
    .limit(1);
  if (!policy) throw new Error("Policy not found");
  return db
    .select()
    .from(caseClosurePolicyVersions)
    .where(
      and(
        eq(caseClosurePolicyVersions.policyId, policyId),
        eq(caseClosurePolicyVersions.organisationId, organisationId),
      ),
    )
    .orderBy(desc(caseClosurePolicyVersions.version));
}

export async function assertUserInOrg(
  organisationId: string,
  userId: string,
): Promise<{ id: string; role: string } | null> {
  const [user] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organisationId, organisationId)))
    .limit(1);
  return user ?? null;
}

