"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { normalizeTags } from "@/lib/tags";
import { recordAuditEvent } from "@/lib/audit/events";
import { auditContextFromHeaders } from "@/lib/audit/request-context";

export async function saveTeamTags(input: {
  caseTags: string[];
  dataClassificationTags: string[];
}): Promise<void> {
  const user = await requireRole(["admin"]);
  const [organisation] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, user.organisationId))
    .limit(1);
  const settings =
    organisation?.settings && typeof organisation.settings === "object"
      ? (organisation.settings as Record<string, unknown>)
      : {};
  const previousTeamTags =
    settings.team_tags && typeof settings.team_tags === "object"
      ? (settings.team_tags as Record<string, unknown>)
      : null;
  const nextCaseTags = normalizeTags(input.caseTags);
  const nextDataClassificationTags = normalizeTags(
    input.dataClassificationTags,
  );
  await db
    .update(organisations)
    .set({
      settings: {
        ...settings,
        team_tags: {
          case_tags: nextCaseTags,
          data_classification_tags: nextDataClassificationTags,
        },
      },
    })
    .where(eq(organisations.id, user.organisationId));
  await recordAuditEvent({
    organisationId: user.organisationId,
    actorId: user.id,
    actorType: "user",
    actorLabel: user.email,
    action: "team_tags.updated",
    targetType: "organisation",
    targetId: user.organisationId,
    before: previousTeamTags,
    after: {
      case_tags: nextCaseTags,
      data_classification_tags: nextDataClassificationTags,
    },
    ...auditContextFromHeaders(await headers()),
  });
  revalidatePath("/settings/tags");
  revalidatePath("/cases/new");
}
