import { NextResponse } from "next/server";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cases, caseTasks } from "@/db/schema";
import { authenticateApiTokenWithScope } from "@/lib/api-tokens";
import { TASK_STATUS_VALUES } from "@/lib/tasks-core";

export async function GET(req: Request) {
  const auth = await authenticateApiTokenWithScope(req, "tasks:read");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.reason }, { status: auth.status });
  }
  const url = new URL(req.url);
  const requestedStatus = url.searchParams.get("status") ?? "open";
  const mine = url.searchParams.get("mine") === "true";
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 200);
  if (
    requestedStatus !== "open" &&
    requestedStatus !== "all" &&
    !(TASK_STATUS_VALUES as readonly string[]).includes(requestedStatus)
  ) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const filters = [eq(cases.organisationId, auth.token.organisationId)];
  if (requestedStatus === "open") {
    filters.push(sql`${caseTasks.status} <> 'done'`);
  } else if (requestedStatus !== "all") {
    filters.push(sql`${caseTasks.status} = ${requestedStatus}`);
  }
  if (mine) {
    if (!auth.token.createdBy) {
      return NextResponse.json({ tasks: [] });
    }
    filters.push(eq(caseTasks.assigneeId, auth.token.createdBy));
  }
  const dueRank = sql<number>`case
    when ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} < now() then 0
    when ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} <= now() + interval '24 hours' then 1
    when ${caseTasks.status} <> 'done' and ${caseTasks.dueAt} is not null then 2
    when ${caseTasks.status} <> 'done' then 3
    else 4 end`;
  const rows = await db
    .select({
      id: caseTasks.id,
      caseId: caseTasks.caseId,
      title: caseTasks.title,
      description: caseTasks.description,
      status: caseTasks.status,
      assigneeId: caseTasks.assigneeId,
      dueAt: caseTasks.dueAt,
      completedAt: caseTasks.completedAt,
      createdAt: caseTasks.createdAt,
      caseNumber: cases.caseNumber,
      caseTitle: cases.title,
      caseSeverity: cases.severity,
    })
    .from(caseTasks)
    .innerJoin(cases, eq(cases.id, caseTasks.caseId))
    .where(and(...filters))
    .orderBy(
      asc(dueRank),
      sql`${caseTasks.dueAt} asc nulls last`,
      asc(cases.caseNumber),
      asc(caseTasks.orderIndex),
    )
    .limit(limit);
  return NextResponse.json({ tasks: rows });
}
