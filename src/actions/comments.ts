"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cases, comments, users } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireRole } from "@/lib/session";
import { newId } from "@/lib/utils";
import { writeTimelineEvent } from "@/lib/timeline";
import { sendEmail } from "@/lib/email";

function extractMentions(body: string): string[] {
  const matches = body.match(/@[A-Za-z0-9_.+-]+/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

export async function postComment(formData: FormData) {
  const user = await requireRole(["admin", "analyst"]);
  const caseId = String(formData.get("caseId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!caseId || !body) throw new Error("caseId and body required");

  const [c] = await db
    .select()
    .from(cases)
    .where(and(eq(cases.id, caseId), eq(cases.organisationId, user.organisationId)))
    .limit(1);
  if (!c) throw new Error("Case not found");

  const mentionTokens = extractMentions(body);
  let mentionedUserIds: string[] = [];
  let mentionedUsers: Array<{ id: string; email: string; name: string }> = [];
  if (mentionTokens.length > 0) {
    const candidates = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(eq(users.organisationId, user.organisationId));
    mentionedUsers = candidates.filter((u) => {
      const handle = u.email.split("@")[0]?.toLowerCase();
      return (
        mentionTokens.includes(handle ?? "") ||
        mentionTokens.includes(u.name.toLowerCase().replace(/\s+/g, "."))
      );
    });
    mentionedUserIds = mentionedUsers.map((u) => u.id);
  }

  const id = newId("cmt");
  await db.insert(comments).values({
    id,
    caseId,
    authorId: user.id,
    body,
    mentions: mentionedUserIds,
  });
  await writeTimelineEvent({
    caseId,
    actorId: user.id,
    eventType: "comment",
    payload: {
      comment_id: id,
      preview: body.length > 120 ? body.slice(0, 117) + "..." : body,
    },
  });

  // Notify mentioned users by email.
  if (mentionedUsers.length > 0) {
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${caseId}/comments`;
    for (const u of mentionedUsers) {
      if (u.id === user.id) continue;
      await sendEmail({
        to: u.email,
        subject: `[Kelpie] ${user.name} mentioned you on ${c.caseNumber}`,
        text: `${user.name} mentioned you on case ${c.caseNumber} — ${c.title}\n\n${body}\n\n${url}`,
      });
    }
  }

  revalidatePath(`/cases/${caseId}/comments`);
  revalidatePath(`/cases/${caseId}/timeline`);
}
