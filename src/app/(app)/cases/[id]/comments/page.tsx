import { db } from "@/db";
import { comments, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";
import { requireUser } from "@/lib/session";
import { renderSafeMarkdown } from "@/lib/markdown";
import CommentForm from "@/components/comment-form";

type Props = { params: Promise<{ id: string }> };

export default async function CaseCommentsPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser();
  const rows = await db
    .select({
      id: comments.id,
      body: comments.body,
      mentions: comments.mentions,
      createdAt: comments.createdAt,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(comments)
    .leftJoin(users, eq(users.id, comments.authorId))
    .where(eq(comments.caseId, id))
    .orderBy(desc(comments.createdAt));

  const orgUsers = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.organisationId, user.organisationId));

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2 space-y-3">
        {rows.length === 0 ? (
          <div className="kelpie-card p-8 text-center text-sm text-slate-500">
            No comments yet. Start the conversation.
          </div>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="kelpie-card p-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span className="text-slate-200 font-medium">
                  {c.authorName ?? "Unknown"}
                </span>
                <span>{format(c.createdAt, "PP p")}</span>
              </div>
              <div
                className="prose-markdown text-sm text-slate-100"
                dangerouslySetInnerHTML={{
                  __html: renderSafeMarkdown(c.body),
                }}
              />
            </div>
          ))
        )}
      </div>
      <div>
        <CommentForm caseId={id} users={orgUsers} />
      </div>
    </div>
  );
}
