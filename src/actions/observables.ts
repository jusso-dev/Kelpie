"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  addObservableCore,
  OBSERVABLE_TLPS,
  OBSERVABLE_TYPES,
  type ObservableTlp,
  type ObservableType,
} from "@/lib/observables-core";
import { enrichObservable } from "@/lib/enrichment";

export async function addObservable(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const typeRaw = String(formData.get("type") ?? "other");
  const value = String(formData.get("value") ?? "").trim();
  const tlpRaw = String(formData.get("tlp") ?? "amber");
  const description = String(formData.get("description") ?? "").trim();
  const isIoc = formData.get("isIoc") === "on";
  if (!caseId || !value) throw new Error("caseId and value required");
  const type = (OBSERVABLE_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as ObservableType)
    : "other";
  const tlp = (OBSERVABLE_TLPS as readonly string[]).includes(tlpRaw)
    ? (tlpRaw as ObservableTlp)
    : "amber";
  const created = await addObservableCore(user.organisationId, user.id, caseId, {
    type,
    value,
    tlp,
    description: description || null,
    isIoc,
  });
  void enrichObservable(created.id, type, value).catch(() => {});
  revalidatePath(`/cases/${caseId}/observables`);
  revalidatePath(`/observables`);
}
