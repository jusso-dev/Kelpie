"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import {
  createOrUpdateAlertFromProviderCore,
  getOrCreateAlertSourceCore,
  linkAlertToCaseCore,
  setAlertDispositionCore,
  type AlertDispositionPatch,
} from "@/lib/investigations/alerts-core";

export async function createManualAlert(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const severity = String(formData.get("severity") ?? "medium") as
    | "informational"
    | "low"
    | "medium"
    | "high"
    | "critical";
  if (!caseId || !title) throw new Error("caseId and title required");

  const source = await getOrCreateAlertSourceCore({
    organisationId: user.organisationId,
    kind: "manual",
    name: "Manually created alerts",
    createdBy: user.id,
  });
  const { alert } = await createOrUpdateAlertFromProviderCore({
    organisationId: user.organisationId,
    sourceId: source.id,
    externalId: newId("manualalert"),
    title,
    description: description || null,
    detectionSource: "manual",
    severity,
    providerCreatedAt: new Date(),
  });
  await linkAlertToCaseCore({
    organisationId: user.organisationId,
    actorId: user.id,
    caseId,
    alertId: alert.id,
    isPrimary: false,
  });
  revalidatePath(`/cases/${caseId}/alerts`);
}

export async function updateAlertDisposition(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const alertId = String(formData.get("alertId") ?? "");
  if (!caseId || !alertId) throw new Error("caseId and alertId required");

  const patch: AlertDispositionPatch = {};
  const status = formData.get("status");
  if (status) patch.status = String(status) as AlertDispositionPatch["status"];
  const determination = formData.get("determination");
  if (determination) {
    patch.determination = String(determination) as AlertDispositionPatch["determination"];
  }
  const notes = formData.get("analystNotes");
  if (notes !== null) patch.analystNotes = String(notes).trim() || null;

  await setAlertDispositionCore({
    organisationId: user.organisationId,
    actorId: user.id,
    alertId,
    patch,
  });
  revalidatePath(`/cases/${caseId}/alerts`);
}
