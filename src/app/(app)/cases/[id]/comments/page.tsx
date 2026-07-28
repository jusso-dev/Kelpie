import { db } from "@/db";
import { comments, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  authorizeCase,
  canViewSensitiveObject,
  hasPermission,
  REDACTED_PLACEHOLDER,
  resolveUserActor,
} from "@/lib/access";
import { renderSafeMarkdown } from "@/lib/markdown";
import CommentForm from "@/components/comment-form";

type Props = { params: Promise<{ id: string }> };

export default async function CaseCommentsPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const actor = await resolveUserActor(user.organisationId, user.id);
  if (!actor) notFound();
  const gate = await authorizeCase(
    user.organisationId,
    id,
    actor,
    "view_metadata",
  );
  if (!gate.ok) notFound();

  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      mentions: comments.mentions,
      source: comments.source,
      sensitive: comments.sensitive,
      createdAt: comments.createdAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.caseId, id))
    .orderBy(desc(comments.createdAt));

  const visibleRows = rows.map((c) => {
    if (!c.sensitive) return { ...c, redacted: false };
    let canView = hasPermission(gate.permissions, "view_sensitive");
    if (!canView) {
      canView = canViewSensitiveObject(gate.permissions, {
        sensitive: true,
        objectType: "comment",
        objectId: c.id,
        grants: gate.ctx.grants,
        actor,
      });
    }
    if (canView) return { ...c, redacted: false };
    return { ...c, body: REDACTED_PLACEHOLDER, redacted: true };
  });

  const orgUsers = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.organisationId, user.organisationId));

  const canComment =
    (user.role === "admin" || user.role === "analyst") &&
    hasPermission(gate.permissions, "edit");

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        {visibleRows.length === 0 ? (
          <div className="kelpie-card p-8 text-center text-sm text-slate-500">
            No comments yet. Start the conversation.
          </div>
        ) : (
          visibleRows.map((c) => (
            <div
              key={c.id}
              className={`kelpie-card p-4 ${
                c.source === "system"
                  ? "border-[color:var(--color-tan-500)]/40 bg-[color:var(--color-navy-950)]"
                  : ""
              }`}
            >
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="text-slate-200 font-medium">
                  {c.source === "system"
                    ? "Kelpie Intelligence"
                    : c.source === "api"
                      ? "API integration"
                      : c.authorName ?? "Unknown"}
                  {c.sensitive ? (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-400/80">
                      sensitive
                    </span>
                  ) : null}
                </span>
                <span>{format(c.createdAt, "PP p")}</span>
              </div>
              {c.redacted ? (
                <p className="text-sm text-slate-500 italic">{c.body}</p>
              ) : (
                <div
                  className="prose-markdown text-sm text-slate-100"
                  dangerouslySetInnerHTML={{
                    __html: renderSafeMarkdown(c.body),
                  }}
                />
              )}
            </div>
          ))
        )}
      </div>
      <div>
        {canComment ? (
          <CommentForm caseId={id} users={orgUsers} />
        ) : (
          <div className="kelpie-card p-4 text-sm text-slate-500">
            You do not have permission to comment on this case.
          </div>
        )}
      </div>
    </div>
  );
}
