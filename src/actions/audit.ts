"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { recordAuditEvent } from "@/lib/audit/events";
import { auditContextFromHeaders } from "@/lib/audit/request-context";
import { createAuditExportJob, type AuditExportFormat } from "@/lib/audit/export";
import { auditFiltersFromSource } from "@/lib/audit/filters";
import { enqueueKelpieJob } from "@/lib/jobs/enqueue";
import {
  MIN_AUDIT_RETENTION_DAYS,
  auditRetentionDaysFromSettings,
  isValidAuditRetentionDays,
  withAuditRetentionSetting,
} from "@/lib/audit/retention";

function parseExportFormat(raw: FormDataEntryValue | null): AuditExportFormat {
  return raw === "ndjson" ? "ndjson" : "csv";
}

export async function requestAuditExport(formData: FormData): Promise<{ id: string }> {
  const actor = await requireRole(["admin"]);
  const format = parseExportFormat(formData.get("format"));
  const filters = auditFiltersFromSource(formData);
  const job = await createAuditExportJob({
    organisationId: actor.organisationId,
    requestedBy: actor.id,
    format,
    filters,
  });
  await enqueueKelpieJob("export-audit-events", { auditExportJobId: job.id });
  await recordAuditEvent({
    organisationId: actor.organisationId,
    actorId: actor.id,
    actorType: "user",
    actorLabel: actor.email,
    action: "audit_export.requested",
    targetType: "audit_export_job",
    targetId: job.id,
    metadata: { format },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/audit");
  return job;
}

export async function updateAuditRetention(formData: FormData): Promise<void> {
  const actor = await requireRole(["admin"]);
  const days = Number(formData.get("retentionDays"));
  if (!isValidAuditRetentionDays(days)) {
    throw new Error(
      `Retention must be a whole number of days, at least ${MIN_AUDIT_RETENTION_DAYS}.`,
    );
  }
  const [org] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, actor.organisationId))
    .limit(1);
  const previousDays = auditRetentionDaysFromSettings(org?.settings);
  const nextSettings = withAuditRetentionSetting(
    (org?.settings as Record<string, unknown> | null | undefined) ?? {},
    days,
  );
  await db
    .update(organisations)
    .set({ settings: nextSettings })
    .where(eq(organisations.id, actor.organisationId));
  await recordAuditEvent({
    organisationId: actor.organisationId,
    actorId: actor.id,
    actorType: "user",
    actorLabel: actor.email,
    action: "audit_retention.updated",
    targetType: "organisation",
    targetId: actor.organisationId,
    before: { retentionDays: previousDays },
    after: { retentionDays: days },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/audit");
}
