"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { caseTemplates, caseTasks, playbooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import {
  CASE_ENUMS,
  createCaseCore,
  type CaseClassification,
  type CaseSeverity,
  type CaseTlp,
} from "@/lib/cases-core";
import { fireWebhook } from "@/lib/webhooks";
import { writeTimelineEvent } from "@/lib/timeline";
import { startPlaybookOnCase } from "./playbooks";

function pickEnum<T extends readonly string[]>(
  values: T,
  raw: FormDataEntryValue | null,
  fallback: T[number],
): T[number] {
  const v = typeof raw === "string" ? raw : "";
  return (values as readonly string[]).includes(v) ? (v as T[number]) : fallback;
}

type DefaultTask = { title: string; description?: string };

function parseDefaultTasks(raw: FormDataEntryValue | null): DefaultTask[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: DefaultTask[] = [];
    for (const s of parsed) {
      const o = s as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title.trim() : "";
      if (!title) continue;
      out.push({
        title,
        description: typeof o.description === "string" ? o.description : "",
      });
    }
    return out;
  } catch {
    return [];
  }
}

function renderTemplate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key) => {
    return vars[key] ?? "";
  });
}

export async function createCaseTemplate(formData: FormData) {
  const user = await requireRole(["admin"]);
  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Name required");
  const id = newId("ct");
  await db.insert(caseTemplates).values({
    id,
    organisationId: user.organisationId,
    name,
    classification: pickEnum(
      CASE_ENUMS.classification,
      formData.get("classification"),
      "other",
    ),
    defaultSeverity: pickEnum(CASE_ENUMS.severity, formData.get("severity"), "medium"),
    defaultTlp: pickEnum(CASE_ENUMS.tlp, formData.get("tlp"), "amber"),
    summaryTemplate: String(formData.get("summaryTemplate") ?? "") || null,
    defaultPlaybookId: String(formData.get("defaultPlaybookId") ?? "") || null,
    defaultTasks: parseDefaultTasks(formData.get("defaultTasks")),
  });
  revalidatePath("/playbooks");
  revalidatePath("/cases/new");
  redirect("/playbooks");
}

export async function deleteCaseTemplate(formData: FormData) {
  const user = await requireRole(["admin"]);
  const id = String(formData.get("id") ?? "");
  await db
    .delete(caseTemplates)
    .where(
      and(
        eq(caseTemplates.id, id),
        eq(caseTemplates.organisationId, user.organisationId),
      ),
    );
  revalidatePath("/playbooks");
  revalidatePath("/cases/new");
}

export async function applyCaseTemplate(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const templateId = String(formData.get("templateId") ?? "");
  const titleOverride = String(formData.get("title") ?? "").trim();
  if (!templateId) throw new Error("templateId required");

  const [tpl] = await db
    .select()
    .from(caseTemplates)
    .where(
      and(
        eq(caseTemplates.id, templateId),
        eq(caseTemplates.organisationId, user.organisationId),
      ),
    )
    .limit(1);
  if (!tpl) throw new Error("Template not found");

  const vars = {
    date: new Date().toISOString().slice(0, 10),
    reporter: user.name,
    organisation: user.organisationName,
  };
  const title = titleOverride || `${tpl.name} — ${vars.date}`;
  const summary = tpl.summaryTemplate
    ? renderTemplate(tpl.summaryTemplate, vars)
    : "";

  const created = await createCaseCore(user.organisationId, user.id, {
    title,
    summary,
    severity: tpl.defaultSeverity as CaseSeverity,
    tlp: tpl.defaultTlp as CaseTlp,
    classification: tpl.classification as CaseClassification,
  });
  await fireWebhook(user.organisationId, "case.created", {
    case_id: created.id,
    case_number: created.caseNumber,
    title,
    template: tpl.name,
  });

  // Add template tasks first (order 1..N), then optionally the playbook
  // which appends its own tasks at higher order indexes.
  const defaultTasks = Array.isArray(tpl.defaultTasks)
    ? (tpl.defaultTasks as DefaultTask[])
    : [];
  for (let i = 0; i < defaultTasks.length; i++) {
    const t = defaultTasks[i];
    await db.insert(caseTasks).values({
      id: newId("task"),
      caseId: created.id,
      title: t.title,
      description: t.description ?? null,
      orderIndex: i,
    });
    await writeTimelineEvent({
      caseId: created.id,
      actorId: user.id,
      eventType: "task_created",
      payload: { title: t.title, source: "template" },
    });
  }

  if (tpl.defaultPlaybookId) {
    const [pb] = await db
      .select({ id: playbooks.id })
      .from(playbooks)
      .where(
        and(
          eq(playbooks.id, tpl.defaultPlaybookId),
          eq(playbooks.organisationId, user.organisationId),
        ),
      )
      .limit(1);
    if (pb) {
      const fd = new FormData();
      fd.set("caseId", created.id);
      fd.set("playbookId", pb.id);
      await startPlaybookOnCase(fd);
    }
  }

  redirect(`/cases/${created.id}`);
}
