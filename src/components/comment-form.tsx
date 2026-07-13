"use client";

import { useEffect, useState } from "react";
import { postComment } from "@/actions/comments";
import { useCaseCollaboration } from "@/components/case-collaboration";

export default function CommentForm({
  caseId,
  users,
}: {
  caseId: string;
  users: Array<{ name: string; email: string }>;
}) {
  const [body, setBody] = useState("");
  const { beginEditing, endEditing, setTyping } = useCaseCollaboration();

  useEffect(
    () => () => {
      setTyping(false);
      endEditing("comment");
    },
    [endEditing, setTyping],
  );

  return (
    <form
      action={postComment}
      className="kelpie-card space-y-3 p-5"
      onSubmit={() => {
        setTyping(false);
        endEditing("comment");
      }}
    >
      <input type="hidden" name="caseId" value={caseId} />
      <h2 className="text-sm font-medium text-slate-300">Post a comment</h2>
      <label htmlFor="comment-body" className="block text-xs uppercase tracking-wider text-slate-400">
        Comment
      </label>
      <textarea
        id="comment-body"
        name="body"
        className="kelpie-input"
        rows={6}
        value={body}
        placeholder="Markdown supported. @mention by email handle to notify."
        required
        onFocus={() => beginEditing("comment")}
        onBlur={() => {
          setTyping(false);
          endEditing("comment");
        }}
        onChange={(event) => {
          setBody(event.target.value);
          setTyping(event.target.value.trim().length > 0);
        }}
      />
      <details className="text-xs text-slate-500">
        <summary>Who can you @mention?</summary>
        <ul className="mt-1 space-y-0.5">
          {users.map((user) => (
            <li key={user.email}>
              @{user.email.split("@")[0]} <span className="text-slate-600">({user.name})</span>
            </li>
          ))}
        </ul>
      </details>
      <button className="kelpie-btn kelpie-btn-primary w-full justify-center">Post</button>
    </form>
  );
}
