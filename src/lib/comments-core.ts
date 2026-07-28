import { db } from "@/db";
import { cases, comments, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import {
  evaluateCasePermissions,
  hasPermission,
  loadCaseAccessContext,
  resolveUserActor,
} from "./access";
import { newId } from "./utils";
import { writeTimelineEvent } from "./timeline";
import { sendEmail } from "./email";
import { queueMobilePushForUsers } from "./mobile-push";

export function extractMentions(body: string): string[] {
  const matches = body.match(/@[A-Za-z0-9_.+-]+/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

export async function postCommentCore(
  organisationId: string,
  actor: { id: string; name: string } | null,
  caseId: string,
  body: string,
  opts?: { sensitive?: boolean },
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

  const sensitive = Boolean(opts?.sensitive);
  const id = newId("cmt");
  await db.insert(comments).values({
    id,
    caseId,
    authorId: actor?.id ?? null,
    source: actor ? "user" : "api",
    body,
    mentions: mentionedUserIds,
    sensitive,
  });
  // Timeline preview must never carry sensitive comment body (issue #61).
  const timelinePreview = sensitive
    ? "[redacted]"
    : body.length > 120
      ? body.slice(0, 117) + "..."
      : body;
  await writeTimelineEvent({
    caseId,
    actorId: actor?.id ?? null,
    eventType: "comment",
    payload: {
      comment_id: id,
      preview: timelinePreview,
      sensitive,
    },
  });
  if (mentioned.length > 0) {
    // Mentions never grant access. Only notify users who already have
    // know_exists on this case; never include sensitive body text.
    const accessCtx = await loadCaseAccessContext(organisationId, caseId);
    const notifiable: Array<{ id: string; email: string; name: string }> = [];
    if (accessCtx) {
      for (const u of mentioned) {
        if (actor && u.id === actor.id) continue;
        const mentionedActor = await resolveUserActor(organisationId, u.id);
        if (!mentionedActor) continue;
        const perms = evaluateCasePermissions(accessCtx, mentionedActor);
        if (!hasPermission(perms, "know_exists")) continue;
        notifiable.push(u);
      }
    }
    const url = `${process.env.APP_URL ?? "http://localhost:3000"}/cases/${caseId}/comments`;
    const who = actor?.name ?? "An API token";
    for (const u of notifiable) {
      const safeBody = sensitive
        ? "(content withheld — you may need access to view this comment)"
        : body;
      // Case title only when the recipient has view_metadata; otherwise
      // generic copy so restricted titles do not leak via email.
      const mentionedActor = await resolveUserActor(organisationId, u.id);
      const perms =
        accessCtx && mentionedActor
          ? evaluateCasePermissions(accessCtx, mentionedActor)
          : null;
      const titlePart =
        perms && hasPermission(perms, "view_metadata")
          ? ` — ${c.title}`
          : "";
      await sendEmail({
        to: u.email,
        subject: `[Kelpie] ${who} mentioned you on ${c.caseNumber}`,
        text: `${who} mentioned you on case ${c.caseNumber}${titlePart}\n\n${safeBody}\n\n${url}`,
      });
    }
    await queueMobilePushForUsers(
      organisationId,
      notifiable.map((u) => u.id),
      {
        event: "comment_mention",
        sourceId: id,
        title: "You were mentioned in Kelpie",
        body: `${c.caseNumber} has a new mention for you.`,
        destinationType: "case",
        destinationId: caseId,
      },
    );
  }
  return { id, mentionedUserIds };
}
