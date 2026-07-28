"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  cases,
  caseTasks,
  playbooks,
  playbookRuns,
  type PlaybookStep,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { seedBaselineOrganisationData } from "@/lib/baseline-data";
import { OBSERVABLE_TYPES } from "@/lib/observables-core";
import { parseTagsInput } from "@/lib/tags";
import {
  PLAYBOOK_GUIDANCE_CATEGORIES,
  type PlaybookGuidanceCategory,
} from "@/lib/attack/playbook-guidance";

const CLASSIFICATIONS = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
] as const;

const SEVERITIES = ["low", "medium", "high", "critical"] as const;

function pickOptionalEnum<T extends readonly string[]>(
  values: T,
  raw: FormDataEntryValue | null,
): T[number] | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  return (values as readonly string[]).includes(v) ? (v as T[number]) : null;
}

function parseRequiredObservableTypes(formData: FormData): string[] {
  const raw = formData.getAll("requiredObservableTypes");
  const allowed = new Set<string>(OBSERVABLE_TYPES);
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value === "string" && allowed.has(value) && !out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}

type ParsedStep = {
  title: string;
  description: string;
  offsetMinutes: number;
  isRequired: boolean;
  attackTechniqueIds: string[];
  guidanceCategories: PlaybookGuidanceCategory[];
};

function parseAttackTechniqueIds(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim().toUpperCase())
      .filter((v) => /^T\d{4}(\.\d{3})?$/.test(v));
  }
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim().toUpperCase())
      .filter((v) => /^T\d{4}(\.\d{3})?$/.test(v));
  }
  return [];
}

function parseGuidanceCategories(value: unknown): PlaybookGuidanceCategory[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is PlaybookGuidanceCategory =>
    (PLAYBOOK_GUIDANCE_CATEGORIES as readonly string[]).includes(v as string),
  );
}

function parseSteps(raw: FormDataEntryValue | null): ParsedStep[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const result: ParsedStep[] = [];
    for (const s of parsed) {
      const obj = s as Record<string, unknown>;
      const title = typeof obj.title === "string" ? obj.title.trim() : "";
      if (!title) continue;
      result.push({
        title,
        description: typeof obj.description === "string" ? obj.description : "",
        offsetMinutes:
          typeof obj.offsetMinutes === "number" &&
          Number.isFinite(obj.offsetMinutes)
            ? Math.max(0, Math.round(obj.offsetMinutes))
            : 0,
        isRequired: obj.isRequired !== false,
        attackTechniqueIds: parseAttackTechniqueIds(obj.attackTechniqueIds),
        guidanceCategories: parseGuidanceCategories(obj.guidanceCategories),
      });
    }
    return result;
  } catch {
    return [];
  }
}

export async function createPlaybook(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const description = String(formData.get("description") ?? "").trim() || null;
  const classificationRaw = String(formData.get("classification") ?? "other");
  const classification = (CLASSIFICATIONS as readonly string[]).includes(
    classificationRaw,
  )
    ? (classificationRaw as (typeof CLASSIFICATIONS)[number])
    : "other";
  const steps = parseSteps(formData.get("steps")).map<PlaybookStep>((s) => ({
    id: newId("step"),
    title: s.title,
    description: s.description,
    offsetMinutes: s.offsetMinutes,
    isRequired: s.isRequired,
    attackTechniqueIds: s.attackTechniqueIds,
    guidanceCategories: s.guidanceCategories,
  }));
  const defaultSeverity = pickOptionalEnum(SEVERITIES, formData.get("defaultSeverity"));
  const tags = parseTagsInput(String(formData.get("tags") ?? ""));
  const requiredObservableTypes = parseRequiredObservableTypes(formData);

  const id = newId("pb");
  await db.insert(playbooks).values({
    id,
    organisationId: user.organisationId,
    name,
    description,
    classification,
    defaultSeverity,
    steps,
    tags,
    requiredObservableTypes,
  });
  revalidatePath("/playbooks");
  redirect(`/playbooks/${id}`);
}

export async function updatePlaybook(playbookId: string, formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name is required");
  const description = String(formData.get("description") ?? "").trim() || null;
  const classificationRaw = String(formData.get("classification") ?? "other");
  const classification = (CLASSIFICATIONS as readonly string[]).includes(
    classificationRaw,
  )
    ? (classificationRaw as (typeof CLASSIFICATIONS)[number])
    : "other";
  const steps = parseSteps(formData.get("steps")).map<PlaybookStep>((s) => ({
    id: newId("step"),
    title: s.title,
    description: s.description,
    offsetMinutes: s.offsetMinutes,
    isRequired: s.isRequired,
    attackTechniqueIds: s.attackTechniqueIds,
    guidanceCategories: s.guidanceCategories,
  }));
  const defaultSeverity = pickOptionalEnum(SEVERITIES, formData.get("defaultSeverity"));
  const tags = parseTagsInput(String(formData.get("tags") ?? ""));
  const requiredObservableTypes = parseRequiredObservableTypes(formData);

  await db
    .update(playbooks)
    .set({
      name,
      description,
      classification,
      defaultSeverity,
      steps,
      tags,
      requiredObservableTypes,
    })
    .where(
      and(
        eq(playbooks.id, playbookId),
        eq(playbooks.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/playbooks");
  revalidatePath(`/playbooks/${playbookId}`);
}

export async function deletePlaybook(playbookId: string) {
  const user = await requireRole(["admin", "analyst"]);
  await db
    .delete(playbooks)
    .where(
      and(
        eq(playbooks.id, playbookId),
        eq(playbooks.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/playbooks");
}

export async function togglePlaybookActive(playbookId: string, active: boolean) {
  const user = await requireRole(["admin", "analyst"]);
  await db
    .update(playbooks)
    .set({ isActive: active })
    .where(
      and(
        eq(playbooks.id, playbookId),
        eq(playbooks.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/playbooks");
}

export async function startPlaybookOnCase(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const playbookId = String(formData.get("playbookId") ?? "");
  if (!caseId || !playbookId) throw new Error("caseId and playbookId required");

  const [c] = await db
    .select()
    .from(cases)
    .where(
      and(eq(cases.id, caseId), eq(cases.organisationId, user.organisationId)),
    )
    .limit(1);
  if (!c) throw new Error("Case not found");

  const [pb] = await db
    .select()
    .from(playbooks)
    .where(
      and(
        eq(playbooks.id, playbookId),
        eq(playbooks.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!pb) throw new Error("Playbook not found");

  const runId = newId("run");
  const startedAt = new Date();
  await db.insert(playbookRuns).values({
    id: runId,
    caseId,
    playbookId,
    startedBy: user.id,
    startedAt,
  });

  const steps = (pb.steps as PlaybookStep[]) ?? [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const dueAt = new Date(startedAt.getTime() + step.offsetMinutes * 60000);
    await db.insert(caseTasks).values({
      id: newId("task"),
      caseId,
      title: step.title,
      description: step.description ?? null,
      dueAt,
      orderIndex: i,
      playbookRunId: runId,
      playbookStepId: step.id,
      isRequired: step.isRequired === true,
    });
  }
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "playbook_started",
    payload: { playbook_id: pb.id, playbook_name: pb.name, steps: steps.length },
  });

  revalidatePath(`/cases/${caseId}`);
  revalidatePath(`/cases/${caseId}/tasks`);
}

/**
 * Explicit, admin-triggered sync of the baseline playbook catalogue. Adding a
 * new scenario to `src/lib/playbook-catalogue.ts` never appears automatically
 * in an already-onboarded organisation — an admin runs this to pull in any
 * baseline playbooks/templates the organisation does not have yet. It never
 * touches an existing row (see `seedBaselineOrganisationData`), so it is safe
 * to run at any time, including on organisations with customised baseline
 * playbooks.
 */
export async function syncBaselineCatalogue(): Promise<{
  playbooksAdded: number;
  templatesAdded: number;
  templatesRelinked: number;
}> {
  const user = await requireRole(["admin"]);
  const result = await seedBaselineOrganisationData(user.organisationId);
  revalidatePath("/playbooks");
  return {
    playbooksAdded: result.playbooksCreated,
    templatesAdded: result.templatesCreated,
    templatesRelinked: result.templatesRelinked,
  };
}
