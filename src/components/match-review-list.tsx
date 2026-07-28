"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { resolveMatchReviewAction } from "@/actions/asset-context";

type Review = {
  id: string;
  matchReason: string | null;
  candidateEntityIds: unknown;
};

export default function MatchReviewList({
  reviews,
  canEdit,
}: {
  reviews: Review[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (reviews.length === 0) {
    return <p className="text-sm text-slate-400">No pending reviews.</p>;
  }

  return (
    <ul className="space-y-3">
      {reviews.map((r) => {
        const candidates = Array.isArray(r.candidateEntityIds)
          ? (r.candidateEntityIds as string[])
          : [];
        return (
          <li key={r.id} className="border border-slate-800 rounded p-3 text-sm">
            <p className="font-mono text-xs text-slate-500">{r.id}</p>
            <p className="text-slate-300 mt-1">{r.matchReason}</p>
            <p className="text-xs text-slate-400 mt-1">
              Candidates: {candidates.join(", ")}
            </p>
            {canEdit ? (
              <div className="flex flex-wrap gap-2 mt-2">
                {candidates.map((entityId) => (
                  <button
                    key={entityId}
                    type="button"
                    className="kelpie-btn kelpie-btn-secondary text-xs"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        const res = await resolveMatchReviewAction(r.id, {
                          action: "link",
                          entityId,
                        });
                        if (!res.ok) toast.error(res.error);
                        else {
                          toast.success("Linked");
                          router.refresh();
                        }
                      })
                    }
                  >
                    Link {entityId.slice(0, 12)}…
                  </button>
                ))}
                <button
                  type="button"
                  className="kelpie-btn kelpie-btn-ghost text-xs"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await resolveMatchReviewAction(r.id, {
                        action: "dismiss",
                      });
                      if (!res.ok) toast.error(res.error);
                      else {
                        toast.success("Dismissed");
                        router.refresh();
                      }
                    })
                  }
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
