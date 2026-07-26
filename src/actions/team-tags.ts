"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireRole } from "@/lib/session";
import { normalizeTags } from "@/lib/tags";

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
  await db
    .update(organisations)
    .set({
      settings: {
        ...settings,
        team_tags: {
          case_tags: normalizeTags(input.caseTags),
          data_classification_tags: normalizeTags(
            input.dataClassificationTags,
          ),
        },
      },
    })
    .where(eq(organisations.id, user.organisationId));
  revalidatePath("/settings/tags");
  revalidatePath("/cases/new");
}
