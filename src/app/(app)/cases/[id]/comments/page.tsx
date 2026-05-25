import { db } from "@/db";
import { comments, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { format } from "date-fns";
import { requireUser } from "@/lib/session";
import { postComment } from "@/actions/comments";
import { renderSafeMarkdown } from "@/lib/markdown";

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
        <form action={postComment} className="kelpie-card p-5 space-y-3">
          <input type="hidden" name="caseId" value={id} />
          <h2 className="text-sm font-medium text-slate-300">Post a comment</h2>
          <label
            htmlFor="comment-body"
            className="block text-xs uppercase tracking-wider text-slate-400"
          >
            Comment
          </label>
          <textarea
            id="comment-body"
            name="body"
            className="kelpie-input"
            rows={6}
            placeholder="Markdown supported. @mention by email handle to notify."
            required
          />
          <details className="text-xs text-slate-500">
            <summary>Who can you @mention?</summary>
            <ul className="mt-1 space-y-0.5">
              {orgUsers.map((u) => (
                <li key={u.email}>
                  @{u.email.split("@")[0]} <span className="text-slate-600">({u.name})</span>
                </li>
              ))}
            </ul>
          </details>
          <button className="kelpie-btn kelpie-btn-primary w-full justify-center">
            Post
          </button>
        </form>
      </div>
    </div>
  );
}
