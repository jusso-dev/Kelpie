"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  createClosurePolicyCore,
  listClosurePoliciesCore,
  setClosurePolicyActiveCore,
  updateClosurePolicyCore,
  type ClosurePolicyInput,
} from "@/lib/closure/policy-core";
import type { ClosureRequirementConfig } from "@/lib/closure/types";
import { parseRequirementConfigs } from "@/lib/closure/evaluate";

export async function listClosurePoliciesAction() {
  const user = await requireRole(["admin", "analyst", "read_only"]);
  return listClosurePoliciesCore(user.organisationId);
}

function inputFromForm(formData: FormData): ClosurePolicyInput {
  const requirementsRaw = String(formData.get("requirements") ?? "[]");
  let requirements: ClosureRequirementConfig[] = [];
  try {
    requirements = parseRequirementConfigs(JSON.parse(requirementsRaw));
  } catch {
    throw new Error("requirements must be valid JSON");
  }
  return {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "") || null,
    templateId: String(formData.get("templateId") ?? "") || null,
    isDefault: formData.get("isDefault") === "true" || formData.get("isDefault") === "on",
    requirements,
    requireTwoPersonOverride:
      formData.get("requireTwoPersonOverride") === "true" ||
      formData.get("requireTwoPersonOverride") === "on",
  };
}

export async function createClosurePolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const result = await createClosurePolicyCore(
    user.organisationId,
    user.id,
    inputFromForm(formData),
  );
  revalidatePath("/settings/closure-policies");
  revalidatePath("/settings");
  return result;
}

export async function updateClosurePolicy(formData: FormData) {
  const user = await requireRole(["admin"]);
  const policyId = String(formData.get("policyId") ?? "");
  if (!policyId) throw new Error("policyId required");
  const result = await updateClosurePolicyCore(
    user.organisationId,
    user.id,
    policyId,
    inputFromForm(formData),
  );
  revalidatePath("/settings/closure-policies");
  return result;
}

export async function setClosurePolicyActive(formData: FormData) {
  const user = await requireRole(["admin"]);
  const policyId = String(formData.get("policyId") ?? "");
  const isActive =
    formData.get("isActive") === "true" || formData.get("isActive") === "on";
  if (!policyId) throw new Error("policyId required");
  await setClosurePolicyActiveCore(
    user.organisationId,
    user.id,
    policyId,
    isActive,
  );
  revalidatePath("/settings/closure-policies");
}
