import Image from "next/image";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { Building2, Check, Filter, Search, X } from "lucide-react";
import { db } from "@/db";
import { vendorWatchlist } from "@/db/schema";
import { VENDOR_CATALOG } from "@/data/vendor-catalog";
import { requireUser } from "@/lib/session";
import {
  UnwatchVendorButton,
  WatchVendorButton,
} from "@/components/vendor-watch-controls";

const PAGE_SIZE = 24;
const CATEGORIES = [...new Set(VENDOR_CATALOG.map((vendor) => vendor.category))].sort(
  (a, b) => a.localeCompare(b),
);

type RawSearchParams = Promise<Record<string, string | string[] | undefined>>;
type CatalogParams = {
  q?: string;
  category?: string;
  page: number;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normaliseParams(
  raw: Record<string, string | string[] | undefined>,
): CatalogParams {
  const q = first(raw.q)?.trim().slice(0, 120) || undefined;
  const rawCategory = first(raw.category);
  const category = CATEGORIES.includes(rawCategory ?? "")
    ? rawCategory
    : undefined;
  const rawPage = Number(first(raw.page));
  return {
    q,
    category,
    page:
      Number.isInteger(rawPage) && rawPage > 0
        ? Math.min(rawPage, 10_000)
        : 1,
  };
}

function queryString(
  current: CatalogParams,
  updates: Partial<Record<keyof CatalogParams, string | number | undefined>>,
): string {
  const merged = { ...current, ...updates };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (
      value !== undefined &&
      value !== "" &&
      !(key === "page" && value === 1)
    ) {
      query.set(key, String(value));
    }
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

export default async function VendorWatchPage({
  searchParams,
}: {
  searchParams: RawSearchParams;
}) {
  const user = await requireUser();
  const [rawParams, watched] = await Promise.all([
    searchParams,
    db
      .select()
      .from(vendorWatchlist)
      .where(eq(vendorWatchlist.organisationId, user.organisationId))
      .orderBy(asc(vendorWatchlist.displayName)),
  ]);
  const params = normaliseParams(rawParams);
  const query = params.q?.toLocaleLowerCase();
  const matches = VENDOR_CATALOG.filter((vendor) => {
    if (params.category && vendor.category !== params.category) return false;
    if (!query) return true;
    return [
      vendor.displayName,
      vendor.name,
      vendor.category,
      ...vendor.tags,
    ].some((value) => value.toLocaleLowerCase().includes(query));
  });
  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(params.page, totalPages);
  params.page = page;
  const entries = matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const watchedSlugs = new Set(watched.map((vendor) => vendor.catalogSlug));
  const canEdit = user.role === "admin" || user.role === "analyst";
  const firstResult = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastResult = Math.min(page * PAGE_SIZE, total);
  const activeFilters = Number(Boolean(params.q)) + Number(Boolean(params.category));

  return (
    <div className="kelpie-page max-w-7xl">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-[color:var(--color-tan-300)]">
            <Building2 size={15} aria-hidden="true" />
            Vendor watch
          </div>
          <h1 className="text-2xl font-semibold text-slate-50">
            Watch vendors used by your organisation
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Import from 606 curated vendors. Kelpie highlights matching public
            cyber reporting in Cyber brief; matches are leads to verify, not
            proof your environment is affected.
          </p>
        </div>
        <Link href="/briefing" className="kelpie-btn kelpie-btn-secondary">
          Back to Cyber brief
        </Link>
      </header>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Watched vendors</h2>
          <p>
            {watched.length} vendor{watched.length === 1 ? "" : "s"} currently
            monitored for news mentions.
          </p>
        </div>
        {watched.length === 0 ? (
          <div className="kelpie-empty">
            <Building2 size={22} aria-hidden="true" />
            <h3>No vendors watched yet</h3>
            <p>Search the catalog below and add vendors your organisation uses.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {watched.map((vendor) => (
              <article
                key={vendor.id}
                className="kelpie-card flex items-center gap-3 p-4"
              >
                <Image
                  src={`/api/vendors/catalog/logo/${vendor.catalogSlug}`}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-lg bg-white object-contain p-1"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium text-slate-100">
                    {vendor.displayName}
                  </h3>
                  <p className="truncate text-xs text-slate-500">
                    {vendor.category}
                  </p>
                </div>
                {canEdit ? (
                  <UnwatchVendorButton
                    id={vendor.id}
                    vendorName={vendor.displayName}
                  />
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="kelpie-section">
        <div className="kelpie-section-header">
          <h2>Vendor catalog</h2>
          <p>Search by vendor, product, category, or capability.</p>
        </div>
        <form
          className="kelpie-panel grid gap-3 p-4 md:grid-cols-[minmax(16rem,1fr)_16rem_auto_auto] md:items-end"
          aria-label="Vendor catalog filters"
        >
          <label className="text-xs font-medium text-slate-300" htmlFor="vendor-search">
            Search
            <span className="relative mt-1 block">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                aria-hidden="true"
              />
              <input
                id="vendor-search"
                name="q"
                defaultValue={params.q}
                className="kelpie-input"
                style={{ paddingLeft: "2.5rem" }}
                placeholder="Search Microsoft, Okta, CrowdStrike…"
              />
            </span>
          </label>
          <label className="text-xs font-medium text-slate-300">
            Category
            <select
              name="category"
              defaultValue={params.category ?? ""}
              className="kelpie-input mt-1"
            >
              <option value="">All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <button className="kelpie-btn kelpie-btn-primary" type="submit">
            <Filter size={16} aria-hidden="true" />
            Apply
          </button>
          {activeFilters > 0 ? (
            <Link
              href="/briefing/vendors"
              className="kelpie-btn kelpie-btn-ghost"
            >
              <X size={16} aria-hidden="true" />
              Clear
            </Link>
          ) : null}
        </form>

        <div className="flex flex-col gap-1 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite">
            Showing {firstResult}-{lastResult} of {total} vendor
            {total === 1 ? "" : "s"}
          </p>
          <p>
            Page {page} of {totalPages}
          </p>
        </div>

        {entries.length === 0 ? (
          <div className="kelpie-empty">
            <Search size={22} aria-hidden="true" />
            <h3>No vendors match</h3>
            <p>Try another name, category, or capability.</p>
            <Link
              href="/briefing/vendors"
              className="kelpie-btn kelpie-btn-secondary"
            >
              Clear filters
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {entries.map((vendor) => {
              const isWatched = watchedSlugs.has(vendor.slug);
              return (
                <article
                  key={vendor.slug}
                  className="kelpie-card flex min-h-48 flex-col p-4"
                >
                  <div className="flex items-start gap-3">
                    <Image
                      src={`/api/vendors/catalog/logo/${vendor.slug}`}
                      alt=""
                      width={48}
                      height={48}
                      className="h-12 w-12 shrink-0 rounded-lg bg-white object-contain p-1"
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-medium text-slate-100">
                        {vendor.displayName}
                      </h3>
                      <p className="mt-1 text-xs text-slate-500">
                        {vendor.category}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1">
                    {vendor.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="kelpie-badge">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto pt-4">
                    {isWatched ? (
                      <span className="kelpie-badge inline-flex items-center gap-1 text-green-400">
                        <Check size={13} aria-hidden="true" />
                        Watching
                      </span>
                    ) : canEdit ? (
                      <WatchVendorButton
                        catalogSlug={vendor.slug}
                        vendorName={vendor.displayName}
                      />
                    ) : (
                      <span className="text-xs text-slate-500">
                        Administrator or analyst access required
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {totalPages > 1 ? (
          <nav
            className="flex items-center justify-between gap-3"
            aria-label="Vendor catalog pages"
          >
            {page > 1 ? (
              <Link
                href={`/briefing/vendors${queryString(params, { page: page - 1 })}`}
                className="kelpie-btn kelpie-btn-secondary"
              >
                Previous
              </Link>
            ) : (
              <span />
            )}
            {page < totalPages ? (
              <Link
                href={`/briefing/vendors${queryString(params, { page: page + 1 })}`}
                className="kelpie-btn kelpie-btn-secondary"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
