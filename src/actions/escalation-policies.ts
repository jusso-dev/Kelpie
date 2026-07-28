"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  createEscalationPolicyCore,
  listEscalationPoliciesCore,
  setEscalationPolicyActiveCore,
  testEscalationPolicyCore,
  updateEscalationPolicyCore,
  type EscalationPolicyInput,
} from "@/lib/escalation-core";

export async function createEscalationPolicy(
  input: EscalationPolicyInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireRole(["admin"]);
  try {
    const result = await createEscalationPolicyCore(user.organisationId, user.id, input);
    revalidatePath("/settings/escalation-policies");
    return { ok: true, id: result.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed" };
  }
}

export async function updateEscalationPolicy(
  policyId: string,
  input: EscalationPolicyInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireRole(["admin"]);
  try {
    await updateEscalationPolicyCore(user.organisationId, policyId, input);
    revalidatePath("/settings/escalation-policies");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed" };
  }
}

export async function setEscalationPolicyActive(policyId: string, isActive: boolean) {
  const user = await requireRole(["admin"]);
  await setEscalationPolicyActiveCore(user.organisationId, policyId, isActive);
  revalidatePath("/settings/escalation-policies");
}

export async function listEscalationPolicies() {
  const user = await requireRole(["admin"]);
  return listEscalationPoliciesCore(user.organisationId);
}

export async function testEscalationPolicy(policyId: string, caseId: string) {
  const user = await requireRole(["admin"]);
  return testEscalationPolicyCore(user.organisationId, policyId, caseId);
}
