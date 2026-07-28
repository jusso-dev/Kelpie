import Link from "next/link";
import { requireUser } from "@/lib/session";
import { getPriorityScoringSettings } from "@/lib/asset-context/settings";
import { listPendingMatchReviews, listContextsCore } from "@/lib/asset-context/context-core";
import AssetContextImport from "@/components/asset-context-import";
import PriorityScoringSettingsForm from "@/components/priority-scoring-settings";
import MatchReviewList from "@/components/match-review-list";

export default async function AssetContextSettingsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [settings, reviews, sample] = await Promise.all([
    getPriorityScoringSettings(user.organisationId),
    listPendingMatchReviews(user.organisationId),
    listContextsCore(user.organisationId, { limit: 5 }),
  ]);

  return (
    <div className="kelpie-page max-w-4xl space-y-6">
      <header>
        <Link href="/settings" className="text-xs text-slate-400 hover:text-slate-200">
          ← Settings
        </Link>
        <h1 className="text-2xl font-semibold mt-1">Asset & identity context</h1>
        <p className="text-sm text-slate-400 mt-1">
          Import criticality and privilege context, tune explainable priority
          scoring, and resolve ambiguous entity matches.
        </p>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>CSV import</h2>
          <p>Dry-run validates rows; import upserts idempotently per organisation.</p>
        </div>
        {user.role === "read_only" ? (
          <p className="text-sm text-slate-400">Read-only role cannot import.</p>
        ) : (
          <AssetContextImport />
        )}
      </section>

      {isAdmin ? (
        <section className="kelpie-section">
          <div className="kelpie-section-header">
            <h2>Priority scoring</h2>
            <p>
              Weights are bounded 0–1. Disable scoring to fall back to severity-only
              baseline. Source severity remains a separate case field.
            </p>
          </div>
          <PriorityScoringSettingsForm initial={settings} />
        </section>
      ) : null}

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Pending match reviews</h2>
          <p>
            Ambiguous entity matches are never auto-linked — resolve them here.
          </p>
        </div>
        <MatchReviewList
          reviews={reviews.map((r) => ({
            id: r.id,
            matchReason: r.matchReason,
            candidateEntityIds: r.candidateEntityIds,
          }))}
          canEdit={user.role !== "read_only"}
        />
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Recent context records</h2>
          <p>
            <Link href="/asset-context" className="kelpie-link">
              View all
            </Link>
          </p>
        </div>
        {sample.length === 0 ? (
          <p className="text-sm text-slate-400">No context records yet.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {sample.map((c) => (
              <li key={c.id}>
                <span className="font-medium">{c.displayName}</span>{" "}
                <span className="text-slate-500">{c.kind}</span>{" "}
                <span className="kelpie-badge">{c.criticality}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
