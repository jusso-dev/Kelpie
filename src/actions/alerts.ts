"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  dismissAlertsCore,
  promoteAlertToCaseCore,
} from "@/lib/alert-triage";

export async function dismissAlerts(alertIds: string[]) {
  const user = await requireRole(["admin", "analyst"]);
  await dismissAlertsCore(user.organisationId, user.id, alertIds);
  revalidatePath("/alerts");
}

export async function promoteAlertToCase(alertId: string) {
  const user = await requireRole(["admin", "analyst"]);
  const { caseId } = await promoteAlertToCaseCore(
    user.organisationId,
    user.id,
    alertId,
  );

  revalidatePath("/alerts");
  revalidatePath("/cases");
  return { caseId };
}
