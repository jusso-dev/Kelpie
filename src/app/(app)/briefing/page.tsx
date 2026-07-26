import Image from "next/image";
import Link from "next/link";
import {
  Building2,
  ExternalLink,
  Filter,
  Newspaper,
  Search,
  X,
} from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { formatDistanceToNowStrict } from "date-fns";
import { db } from "@/db";
import { vendorWatchlist } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { CYBER_NEWS_SOURCES, getCyberNews } from "@/lib/cyber-news";
import { matchingVendors, type WatchedVendor } from "@/lib/vendor-news";

const PAGE_SIZE = 12;
const SORTS = ["newest", "oldest", "source"] as const;
const SOURCE_NAMES = CYBER_NEWS_SOURCES.map((source) => source.name);

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;
type BriefingParams = {
  q?: string;
  source?: string;
  vendor?: string;
  sort: (typeof SORTS)[number];
  page: number;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normaliseParams(
  raw: Record<string, string | string[] | undefined>,
  watchedVendors: WatchedVendor[],
): BriefingParams {
  const q = first(raw.q)?.trim().slice(0, 120) || undefined;
  const rawSource = first(raw.source);
  const source = SOURCE_NAMES.includes(
    rawSource as (typeof SOURCE_NAMES)[number],
  )
    ? rawSource
    : undefined;
  const rawSort = first(raw.sort);
  const sort = SORTS.includes(rawSort as (typeof SORTS)[number])
    ? (rawSort as (typeof SORTS)[number])
    : "newest";
  const rawPage = Number(first(raw.page));
  const rawVendor = first(raw.vendor);
  const vendor =
    rawVendor === "watched" ||
    watchedVendors.some((item) => item.catalogSlug === rawVendor)
      ? rawVendor
      : undefined;
  return {
    q,
    source,
    vendor,
    sort,
    page:
      Number.isInteger(rawPage) && rawPage > 0
        ? Math.min(rawPage, 10_000)
        : 1,
  };
}

function queryString(
  current: BriefingParams,
  updates: Partial<Record<keyof BriefingParams, string | number | undefined>>,
): string {
  const merged = { ...current, ...updates };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (
      value !== undefined &&
      value !== "" &&
      !(key === "sort" && value === "newest") &&
      !(key === "page" && value === 1)
    ) {
      query.set(key, String(value));
    }
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

function publishedTime(value: string | null): number {
  return value ? Date.parse(value) : 0;
}

export default async function CyberBriefingPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const user = await requireUser();
  const [rawParams, result, watchedVendors] = await Promise.all([
    searchParams,
    getCyberNews(),
    db
      .select({
        id: vendorWatchlist.id,
        catalogSlug: vendorWatchlist.catalogSlug,
        displayName: vendorWatchlist.displayName,
        website: vendorWatchlist.website,
        category: vendorWatchlist.category,
        aliases: vendorWatchlist.aliases,
      })
      .from(vendorWatchlist)
      .where(eq(vendorWatchlist.organisationId, user.organisationId))
      .orderBy(asc(vendorWatchlist.displayName)),
  ]);
  const params = normaliseParams(rawParams, watchedVendors);
  const query = params.q?.toLocaleLowerCase();
  const matchesByItem = new Map(
    result.items.map((item) => [
      item.id,
      matchingVendors(item, watchedVendors),
    ]),
  );
  const filteredItems = result.items.filter((item) => {
    if (params.source && item.source !== params.source) return false;
    const vendorMatches = matchesByItem.get(item.id) ?? [];
    if (
      params.vendor === "watched" &&
      vendorMatches.length === 0
    ) {
      return false;
    }
    if (
      params.vendor &&
      params.vendor !== "watched" &&
      !vendorMatches.some((vendor) => vendor.catalogSlug === params.vendor)
    ) {
      return false;
    }
    return (
      !query ||
      item.title.toLocaleLowerCase().includes(query) ||
      item.summary.toLocaleLowerCase().includes(query)
    );
  });
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (params.sort === "oldest") {
      return (
        (publishedTime(a.publishedAt) || Number.POSITIVE_INFINITY) -
        (publishedTime(b.publishedAt) || Number.POSITIVE_INFINITY)
      );
    }
    if (params.sort === "source") {
      return (
        a.source.localeCompare(b.source) ||
        publishedTime(b.publishedAt) - publishedTime(a.publishedAt)
      );
    }
    return publishedTime(b.publishedAt) - publishedTime(a.publishedAt);
  });
  const total = sortedItems.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(params.page, totalPages);
  params.page = page;
  const visibleItems = sortedItems.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const firstResult = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, total);
  const activeControls =
    Number(Boolean(params.q)) +
    Number(Boolean(params.source)) +
    Number(Boolean(params.vendor)) +
    Number(params.sort !== "newest");

  return (
    <div className="kelpie-page max-w-6xl">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-50">Cyber brief</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            Recent reporting from public cyber authorities. Open the source and
            verify details before using them in a case.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs text-slate-500">
            Refreshed{" "}
            {formatDistanceToNowStrict(new Date(result.refreshedAt), {
              addSuffix: true,
            })}
          </p>
          <Link
            href="/briefing/vendors"
            className="kelpie-btn kelpie-btn-secondary"
          >
            <Building2 size={16} aria-hidden="true" />
            Manage vendor watch
          </Link>
        </div>
      </header>

      {result.failedSources.length ? (
        <div className="kelpie-notice kelpie-notice-warning" role="status">
          <strong>Some sources are temporarily unavailable.</strong>
          <span>
            Showing everything received successfully. Could not refresh{" "}
            {result.failedSources.join(", ")}.
          </span>
        </div>
      ) : null}

      {result.items.length > 0 ? (
        <form
          className="kelpie-panel space-y-4 p-4"
          aria-label="Cyber brief filters"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label
              className="min-w-0 flex-1 text-xs font-medium text-slate-300"
              htmlFor="briefing-search"
            >
              Search
              <span className="relative mt-1 block">
                <Search
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                />
                <input
                  id="briefing-search"
                  name="q"
                  defaultValue={params.q}
                  className="kelpie-input"
                  style={{ paddingLeft: "2.5rem" }}
                  placeholder="Search headlines and summaries"
                />
              </span>
            </label>
            <button className="kelpie-btn kelpie-btn-primary" type="submit">
              <Filter size={16} aria-hidden="true" />
              Apply
            </button>
            {activeControls > 0 ? (
              <Link href="/briefing" className="kelpie-btn kelpie-btn-ghost">
                <X size={16} aria-hidden="true" />
                Clear
              </Link>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-medium text-slate-300">
              Source
              <select
                name="source"
                defaultValue={params.source ?? ""}
                className="kelpie-input mt-1"
              >
                <option value="">All sources</option>
                {SOURCE_NAMES.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-300">
              Watched vendor
              <select
                name="vendor"
                defaultValue={params.vendor ?? ""}
                className="kelpie-input mt-1"
              >
                <option value="">All reporting</option>
                <option value="watched">Any watched vendor</option>
                {watchedVendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.catalogSlug}>
                    {vendor.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-300">
              Sort
              <select
                name="sort"
                defaultValue={params.sort}
                className="kelpie-input mt-1"
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="source">Source</option>
              </select>
            </label>
          </div>
        </form>
      ) : null}

      {result.items.length === 0 ? (
        <div className="kelpie-empty">
          <Newspaper size={22} aria-hidden="true" />
          <h2>No brief available</h2>
          <p>The public feeds could not be read. Try again later.</p>
        </div>
      ) : total === 0 ? (
        <div className="kelpie-empty">
          <Search size={22} aria-hidden="true" />
          <h2>No reporting matches these filters</h2>
          <p>Try another search, source, or watched vendor.</p>
          <Link href="/briefing" className="kelpie-btn kelpie-btn-secondary">
            Clear filters
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite">
              Showing {firstResult}-{lastResult} of {total} report
              {total === 1 ? "" : "s"}
            </p>
            <p>
              Page {page} of {totalPages}
            </p>
          </div>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => (
              <article
                key={item.id}
                className="kelpie-card flex min-h-56 flex-col p-5"
              >
                {(matchesByItem.get(item.id) ?? []).length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {(matchesByItem.get(item.id) ?? [])
                      .slice(0, 3)
                      .map((vendor) => (
                        <span
                          key={vendor.id}
                          className="kelpie-badge inline-flex items-center gap-1.5 text-amber-300"
                        >
                          <Image
                            src={`/api/vendors/catalog/logo/${vendor.catalogSlug}`}
                            alt=""
                            width={16}
                            height={16}
                            unoptimized
                            className="h-4 w-4 rounded bg-white object-contain"
                          />
                          Matches {vendor.displayName}
                        </span>
                      ))}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="kelpie-badge hover:text-slate-100"
                  >
                    {item.source}
                  </a>
                  {item.publishedAt ? (
                    <time
                      dateTime={item.publishedAt}
                      className="shrink-0 text-xs text-slate-500"
                    >
                      {formatDistanceToNowStrict(new Date(item.publishedAt), {
                        addSuffix: true,
                      })}
                    </time>
                  ) : null}
                </div>
                <h2 className="mt-4 text-base font-semibold leading-6 text-slate-100">
                  {item.title}
                </h2>
                {item.summary ? (
                  <p className="mt-2 line-clamp-4 text-sm leading-6 text-slate-400">
                    {item.summary}
                  </p>
                ) : null}
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="kelpie-link mt-auto inline-flex items-center gap-1 pt-5 text-sm"
                >
                  Read at source
                  <ExternalLink size={14} aria-hidden="true" />
                  <span className="sr-only">: {item.title}</span>
                </a>
              </article>
            ))}
          </section>
          {totalPages > 1 ? (
            <nav
              className="flex items-center justify-between gap-3"
              aria-label="Cyber brief pages"
            >
              {page > 1 ? (
                <Link
                  href={`/briefing${queryString(params, { page: page - 1 })}`}
                  className="kelpie-btn kelpie-btn-secondary"
                >
                  Previous
                </Link>
              ) : (
                <span />
              )}
              {page < totalPages ? (
                <Link
                  href={`/briefing${queryString(params, { page: page + 1 })}`}
                  className="kelpie-btn kelpie-btn-secondary"
                >
                  Next
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}
