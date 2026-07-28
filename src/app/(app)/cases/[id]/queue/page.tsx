import { db } from "@/db";
import { cases, teams, users } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { listAdditionalAssigneesCore, listHandoffsCore } from "@/lib/case-ownership-core";
import { listWatchersCore } from "@/lib/watchers-core";
import { CaseQueueControls } from "@/components/case-queue-controls";

type Props = { params: Promise<{ id: string }> };

export default async function CaseQueuePage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();

  const [c] = await db
    .select({
      id: cases.id,
      version: cases.version,
      queueId: cases.queueId,
      acknowledgedAt: cases.acknowledgedAt,
    })
    .from(cases)
    .where(and(eq(cases.id, id), eq(cases.organisationId, user.organisationId)))
    .limit(1);
  if (!c) notFound();

  const [orgTeams, orgUsers, assignees, watchers, handoffs] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(and(eq(teams.organisationId, user.organisationId), eq(teams.isActive, true)))
      .orderBy(asc(teams.name)),
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.organisationId, user.organisationId))
      .orderBy(asc(users.name)),
    listAdditionalAssigneesCore(user.organisationId, id),
    listWatchersCore(user.organisationId, id),
    listHandoffsCore(user.organisationId, id),
  ]);

  return (
    <CaseQueueControls
      caseId={id}
      version={c.version}
      queueId={c.queueId}
      acknowledgedAt={c.acknowledgedAt ? c.acknowledgedAt.toISOString() : null}
      teams={orgTeams}
      users={orgUsers}
      assignees={assignees.map((a) => ({ ...a, addedAt: a.addedAt.toISOString() }))}
      watchers={watchers}
      handoffs={handoffs.map((h) => ({
        id: h.id,
        fromUserId: h.fromUserId,
        toUserId: h.toUserId,
        toQueueId: h.toQueueId,
        note: h.note,
        createdAt: h.createdAt.toISOString(),
      }))}
    />
  );
}
