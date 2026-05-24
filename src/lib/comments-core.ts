import { db } from "@/db";
import { cases, comments, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";
import { sendEmail } from "./email";

export function extractMentions(body: string): string[] {
  const matches = body.match(/@[A-Za-z0-9_.+-]+/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

export async function postCommentCore(
  organisationId: string,
  actor: { id: string; name: string } | null,
  caseId: string,
  body: string,
): Promise<{ id: string; mentionedUserIds: string[] }> {
  if (!body.trim()) throw new Error("body required");
  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");

  const tokens = extractMentions(body);
  let mentionedUserIds: string[] = [];
  let mentioned: Array<{ id: string; email: string; name: string }> = [];
  if (tokens.length > 0) {
    const candidates = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.organisationId, organisationId));
    mentioned = candidates.filter((u) => {
      const handle = u.email.split("@")[0]?.toLowerCase();
      return (
        tokens.includes(handle ?? "") ||
        tokens.includes(u.name.toLowerCase().replace(/\s+/g, "."))
      );
    });
    mentionedUserIds = mentioned.map((u) => u.id);
  }

  const id = newId("cmt");
  await db.insert(comments).values({
    id,
    caseId,
    authorId: actor?.id ?? null,
    body,
    mentions: mentionedUserIds,
  });
  await writeTimelineEvent({
    caseId,
    actorId: actor?.id ?? null,
    eventType: "comment",
    payload: {
      comment_id: id,
      preview: body.length > 120 ? body.slice(0, 117) + "..." : body,
    },
  });
  if (mentioned.length > 0) {
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${caseId}/comments`;
    const who = actor?.name ?? "An API token";
    for (const u of mentioned) {
      if (actor && u.id === actor.id) continue;
      await sendEmail({
        to: u.email,
        subject: `[Kelpie] ${who} mentioned you on ${c.caseNumber}`,
        text: `${who} mentioned you on case ${c.caseNumber} — ${c.title}\n\n${body}\n\n${url}`,
      });
    }
  }
  return { id, mentionedUserIds };
}
