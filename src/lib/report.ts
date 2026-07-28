import { db } from "@/db";
import {
  caseTasks,
  cases,
  comments,
  observables,
  timelineEvents,
  users,
  type Case,
} from "@/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { findTechnique } from "@/data/mitre";
import { listMappingsForCase, type MappingView } from "@/lib/attack/mapping-core";
import { listStoryCore, type StoryEntryView } from "@/lib/attack/story-core";
import {
  listReportContentBlocksCore,
  type ContentBlockView,
} from "@/lib/content-blocks-core";

export type CaseReportData = {
  case: Case;
  assignee: { id: string; name: string; email: string } | null;
  reporter: { id: string; name: string; email: string } | null;
  observables: Array<{
    id: string;
    type: string;
    value: string;
    tlp: string;
    isIoc: boolean;
    description: string | null;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    status: string;
    dueAt: Date | null;
    completedAt: Date | null;
    completedByName: string | null;
  }>;
  timeline: Array<{
    eventType: string;
    payload: unknown;
    occurredAt: Date;
    actorName: string | null;
  }>;
  comments: Array<{ id: string; body: string; createdAt: Date; authorName: string | null }>;
  attackMappings: MappingView[];
  attackStory: StoryEntryView[];
  /** Ordered content blocks selected for export (excludes sensitive by default). */
  contentBlocks: ContentBlockView[];
};

export async function loadCaseReport(
  organisationId: string,
  caseId: string,
): Promise<CaseReportData | null> {
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!c) return null;

  const [assignee, reporter] = await Promise.all([
    c.assigneeId
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, c.assigneeId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    c.reporterId
      ? db
          .select({ id: users.id, name: users.name, email: users.email })
          .from(users)
          .where(eq(users.id, c.reporterId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  const obs = await db
    .select()
    .from(observables)
    .where(eq(observables.caseId, caseId))
    .orderBy(asc(observables.createdAt));

  const tasksRaw = await db
    .select({
      id: caseTasks.id,
      title: caseTasks.title,
      description: caseTasks.description,
      status: caseTasks.status,
      dueAt: caseTasks.dueAt,
      completedAt: caseTasks.completedAt,
      completedByName: users.name,
    })
    .from(caseTasks)
    .leftJoin(users, eq(users.id, caseTasks.completedBy))
    .where(eq(caseTasks.caseId, caseId))
    .orderBy(asc(caseTasks.orderIndex));

  const timeline = await db
    .select({
      eventType: timelineEvents.eventType,
      payload: timelineEvents.payload,
      occurredAt: timelineEvents.occurredAt,
      actorName: users.name,
    })
    .from(timelineEvents)
    .leftJoin(users, eq(users.id, timelineEvents.actorId))
    .where(eq(timelineEvents.caseId, caseId))
    .orderBy(asc(timelineEvents.occurredAt));

  const commentRows = await db
    .select({
      id: comments.id,
      body: comments.body,
      createdAt: comments.createdAt,
      authorName:
        sql<string>`case when ${comments.source} = 'system' then 'Kelpie Intelligence' when ${comments.source} = 'api' then 'API integration' else ${users.name} end`,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.caseId, caseId))
    .orderBy(asc(comments.createdAt));

  const [attackMappings, attackStory, contentBlocks] = await Promise.all([
    listMappingsForCase(organisationId, caseId),
    listStoryCore(organisationId, caseId),
    listReportContentBlocksCore(organisationId, caseId),
  ]);

  return {
    case: c,
    assignee,
    reporter,
    observables: obs.map((o) => ({
      id: o.id,
      type: o.type,
      value: o.value,
      tlp: o.tlp,
      isIoc: o.isIoc,
      description: o.description,
    })),
    tasks: tasksRaw,
    timeline,
    comments: commentRows,
    attackMappings,
    attackStory,
    contentBlocks,
  };
}

export function renderTlpBanner(tlp: string): string | null {
  if (tlp === "amber_strict") {
    return "TLP:AMBER+STRICT — restricted distribution. Share only with named recipients within the responding organisation, no external parties without explicit owner permission.";
  }
  if (tlp === "red") {
    return "TLP:RED — recipients may not share this information with any parties outside of the specific exchange, meeting, or conversation in which it was originally disclosed.";
  }
  if (tlp === "amber") {
    return "TLP:AMBER — limited to participants' organisations on a need-to-know basis.";
  }
  return null;
}

function summarisePayload(eventType: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  switch (eventType) {
    case "status_change":
      return `${p.from ?? "?"} → ${p.to ?? "?"}${p.reason ? ` (${p.reason})` : ""}`;
    case "severity_change":
      return `${p.from ?? "?"} → ${p.to ?? "?"}`;
    case "assignment_change":
      return p.to ? "assignee set" : "assignee cleared";
    case "task_created":
    case "task_completed":
    case "task_updated":
      return String(p.title ?? "");
    case "observable_added":
      return `${p.type ?? ""}: ${p.value ?? ""}`;
    case "playbook_started":
      return `${p.playbook_name ?? ""} (${p.steps ?? 0} steps)`;
    case "comment":
      return String(p.preview ?? "");
    case "content_block_changed":
      return `${p.action ?? "changed"}${p.title ? `: ${p.title}` : ""}${p.revision != null ? ` (rev ${p.revision})` : ""}`;
    case "sla_breach":
      return `gate=${p.gate} +${p.minutes_over}m`;
    default:
      return JSON.stringify(p);
  }
}

export function renderCaseMarkdown(data: CaseReportData): string {
  const c = data.case;
  const lines: string[] = [];
  const banner = renderTlpBanner(c.tlp);
  const tags = Array.isArray(c.tags) ? (c.tags as string[]) : [];
  const dataTags = Array.isArray(c.dataClassificationTags)
    ? (c.dataClassificationTags as string[])
    : [];
  if (banner) {
    lines.push(`> **${banner}**`, "");
  }
  lines.push(
    `# ${c.caseNumber} — ${c.title}`,
    "",
    `- Status: **${c.status.replace(/_/g, " ")}**`,
    `- Severity: **${c.severity}**`,
    `- TLP: **${c.tlp.replace("_", "+")}**`,
    `- PAP: **${c.pap}**`,
    `- Classification: ${c.classification.replace(/_/g, " ")}`,
    `- Data tags: ${dataTags.length > 0 ? dataTags.join(", ") : "none"}`,
    `- Tags: ${tags.length > 0 ? tags.join(", ") : "none"}`,
    `- Opened: ${c.openedAt.toISOString()}`,
  );
  if (c.acknowledgedAt) lines.push(`- Acknowledged: ${c.acknowledgedAt.toISOString()}`);
  if (c.containedAt) lines.push(`- Contained: ${c.containedAt.toISOString()}`);
  if (c.resolvedAt) lines.push(`- Resolved: ${c.resolvedAt.toISOString()}`);
  if (c.closedAt) lines.push(`- Closed: ${c.closedAt.toISOString()}`);
  if (data.assignee) lines.push(`- Assignee: ${data.assignee.name} <${data.assignee.email}>`);
  if (data.reporter) lines.push(`- Reporter: ${data.reporter.name} <${data.reporter.email}>`);
  lines.push("");
  if (c.summary) {
    lines.push(`## Summary`, "", c.summary, "");
  }
  const techniques = (c.mitreTechniques as string[]) ?? [];
  if (techniques.length > 0) {
    lines.push("## MITRE ATT&CK", "");
    for (const id of techniques) {
      const t = findTechnique(id);
      lines.push(`- ${id}${t ? ` — ${t.name} (${t.tactic})` : ""}`);
    }
    lines.push("");
  }
  if (data.attackMappings.length > 0) {
    lines.push("## ATT&CK technique mappings", "");
    for (const m of data.attackMappings) {
      const tactics = m.technique.tactics.map((t) => t.name).join(", ");
      lines.push(
        `- \`${m.techniqueId}\`${m.technique.name ? ` — ${m.technique.name}` : ""}${tactics ? ` (${tactics})` : ""}${m.technique.deprecated ? " [deprecated]" : ""} — ${m.entityType}, confidence ${m.confidence ?? "n/a"}, source ${m.source}`,
      );
      if (m.notes) lines.push(`  - Notes: ${m.notes}`);
      if (m.detectionNotes) lines.push(`  - Detection: ${m.detectionNotes}`);
      if (m.responseNotes) lines.push(`  - Response: ${m.responseNotes}`);
      if (m.actorAttribution) lines.push(`  - Actor attribution: ${m.actorAttribution}`);
    }
    lines.push("");
  }
  if (data.attackStory.length > 0) {
    lines.push("## Attack story", "");
    for (const [index, e] of data.attackStory.entries()) {
      lines.push(
        `${index + 1}. **${e.title}** (${e.provenance})${e.techniqueId ? ` — ${e.techniqueId}${e.techniqueName ? ` ${e.techniqueName}` : ""}` : ""}`,
      );
      if (e.description) lines.push(`   ${e.description}`);
    }
    lines.push("");
  }
  if (data.contentBlocks.length > 0) {
    lines.push("## Investigation notes", "");
    for (const b of data.contentBlocks) {
      lines.push(
        `### ${b.title}`,
        "",
        `- Type: ${b.type.replace(/_/g, " ")}`,
        `- TLP: ${b.tlp.replace("_", "+")} · PAP: ${b.pap}`,
        `- Revision: ${b.revisionNumber}`,
        "",
      );
      if (b.content) lines.push(b.content, "");
    }
  }
  if (data.observables.length > 0) {
    lines.push("## Observables", "");
    const byType = new Map<string, typeof data.observables>();
    for (const o of data.observables) {
      const arr = byType.get(o.type) ?? [];
      arr.push(o);
      byType.set(o.type, arr);
    }
    for (const [type, list] of byType) {
      lines.push(`### ${type}`, "");
      for (const o of list) {
        lines.push(
          `- \`${o.value}\` (tlp:${o.tlp})${o.isIoc ? " **IOC**" : ""}${o.description ? ` — ${o.description}` : ""}`,
        );
      }
      lines.push("");
    }
  }
  if (data.tasks.length > 0) {
    lines.push("## Tasks", "");
    for (const t of data.tasks) {
      const status = t.status === "done" ? "[x]" : "[ ]";
      const due = t.dueAt ? ` (due ${t.dueAt.toISOString()})` : "";
      const done = t.completedAt
        ? ` — completed ${t.completedAt.toISOString()}${t.completedByName ? ` by ${t.completedByName}` : ""}`
        : "";
      lines.push(`- ${status} ${t.title}${due}${done}`);
      if (t.description) lines.push(`  - ${t.description.split("\n").join("\n    ")}`);
    }
    lines.push("");
  }
  if (data.timeline.length > 0) {
    lines.push("## Timeline", "");
    for (const e of data.timeline) {
      lines.push(
        `- ${e.occurredAt.toISOString()} — **${e.eventType}** — ${e.actorName ?? "system"} — ${summarisePayload(e.eventType, e.payload)}`,
      );
    }
    lines.push("");
  }
  if (data.comments.length > 0) {
    lines.push("## Comments", "");
    for (const cm of data.comments) {
      lines.push(`### ${cm.authorName ?? "Unknown"} — ${cm.createdAt.toISOString()}`, "");
      lines.push(cm.body, "");
    }
  }
  if (c.status === "closed") {
    lines.push("## Closure", "");
    if (c.closureReason) lines.push(`- Reason: **${c.closureReason}**`);
    if (c.closureSummary) lines.push("", c.closureSummary, "");
  }
  return lines.join("\n");
}
