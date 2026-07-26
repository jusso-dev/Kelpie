import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { normalizeTags } from "@/lib/tags";

export type TeamTags = {
  caseTags: string[];
  dataClassificationTags: string[];
};

export function readTeamTags(settings: unknown): TeamTags {
  const organisationSettings =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};
  const raw =
    organisationSettings.team_tags &&
    typeof organisationSettings.team_tags === "object"
      ? (organisationSettings.team_tags as Record<string, unknown>)
      : {};
  return {
    caseTags: normalizeTags(
      Array.isArray(raw.case_tags) ? raw.case_tags.map(String) : [],
    ),
    dataClassificationTags: normalizeTags(
      Array.isArray(raw.data_classification_tags)
        ? raw.data_classification_tags.map(String)
        : [],
    ),
  };
}

export async function getTeamTags(organisationId: string): Promise<TeamTags> {
  const [organisation] = await db
    .select({ settings: organisations.settings })
    .from(organisations)
    .where(eq(organisations.id, organisationId))
    .limit(1);
  return readTeamTags(organisation?.settings);
}
