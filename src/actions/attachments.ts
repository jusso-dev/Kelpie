"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attachments, cases } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { putFile } from "@/lib/storage";
import { writeTimelineEvent } from "@/lib/timeline";

const MAX_SIZE = 25 * 1024 * 1024;

export async function uploadAttachment(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const file = formData.get("file");
  if (!caseId || !(file instanceof File)) {
    throw new Error("caseId and file are required");
  }
  if (file.size === 0) throw new Error("Empty file");
  if (file.size > MAX_SIZE) throw new Error("File too large (max 25MB)");

  const [c] = await db
    .select({ id: cases.id, organisationId: cases.organisationId })
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, user.organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");

  const buf = Buffer.from(await file.arrayBuffer());
  const stored = await putFile(buf, c.organisationId, file.name);
  const id = newId("att");
  await db.insert(attachments).values({
    id,
    caseId,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: stored.sizeBytes,
    storageKey: stored.key,
    sha256: stored.sha256,
    uploadedBy: user.id,
  });
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "file_uploaded",
    payload: {
      attachment_id: id,
      filename: file.name,
      size_bytes: stored.sizeBytes,
      sha256: stored.sha256,
    },
  });
  revalidatePath(`/cases/${caseId}/attachments`);
}
