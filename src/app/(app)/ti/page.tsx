import { db } from "@/db";
import { tiFeeds } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireUser } from "@/lib/session";
import { feedKinds } from "@/actions/ti";
import TiFeedSettings from "@/components/ti-feed-settings";
import TiBrowser from "@/components/ti-browser";

export default async function ThreatIntelPage() {
  const user = await requireUser();
  const isAdmin = user.role === "admin";
  const [feeds, kinds] = await Promise.all([
    db
      .select()
      .from(tiFeeds)
      .where(eq(tiFeeds.organisationId, user.organisationId))
      .orderBy(desc(tiFeeds.createdAt)),
    feedKinds(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Threat intelligence</h1>
        <p className="text-sm text-slate-400">
          Browse the indicator store and manage the feeds that populate it.
          Matches are attached to observables automatically.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium text-slate-300 mb-2">Browse / search</h2>
        <TiBrowser feeds={feeds.map((f) => ({ id: f.id, name: f.name }))} />
      </section>

      <section className="kelpie-card p-5">
        <h2 className="text-sm font-medium text-slate-300 mb-1">Feeds</h2>
        <p className="text-xs text-slate-500 mb-3">
          CSV/TXT URLs, MISP, and OTX. Each feed polls on its own interval and
          halts on a credential error until cleared.
        </p>
        <TiFeedSettings
          feeds={feeds.map((f) => ({
            id: f.id,
            name: f.name,
            kind: f.kind,
            url: f.url,
            isActive: f.isActive,
            lastPolledAt: f.lastPolledAt ? f.lastPolledAt.toISOString() : null,
            lastError: f.lastError,
            indicatorCount: f.indicatorCount,
            pollIntervalMinutes: f.pollIntervalMinutes,
          }))}
          kinds={kinds}
          isAdmin={isAdmin}
        />
      </section>
    </div>
  );
}
