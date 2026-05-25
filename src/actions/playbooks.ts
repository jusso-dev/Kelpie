"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import {
  cases,
  caseTasks,
  playbooks,
  playbookRuns,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import type { PlaybookStep } from "@/db/schema";

const CLASSIFICATIONS = [
  "malware",
  "phishing",
  "unauthorised_access",
  "data_breach",
  "dos",
  "policy_violation",
  "other",
] as const;

type ParsedStep = {
  title: string;
  description: string;
  offsetMinutes: number;
  isRequired: boolean;
};

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
  }));

  const id = newId("pb");
  await db.insert(playbooks).values({
    id,
    organisationId: user.organisationId,
    name,
    description,
    classification,
    steps,
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
  }));

  await db
    .update(playbooks)
    .set({ name, description, classification, steps })
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
  redirect("/playbooks");
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
