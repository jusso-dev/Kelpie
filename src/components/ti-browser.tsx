"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  indicatorDetail,
  searchIndicators,
  type IndicatorSearchRow,
} from "@/actions/ti";
import { feedbackError } from "@/components/confirm-dialog";
import { TI_INDICATOR_TYPES } from "@/lib/ti/indicator-types";

type Detail = Awaited<ReturnType<typeof indicatorDetail>>;

const TYPES = ["", ...TI_INDICATOR_TYPES];
const CONFIDENCE_THRESHOLDS = ["", "25", "50", "75", "90"] as const;

export default function TiBrowser({
  feeds,
}: {
  feeds: Array<{ id: string; name: string }>;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [feedId, setFeedId] = useState("");
  const [tag, setTag] = useState("");
  const [minConfidence, setMinConfidence] = useState("");
  const [rows, setRows] = useState<IndicatorSearchRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  async function runSearch(e?: React.FormEvent, requestedPage = 1) {
    e?.preventDefault();
    setLoading(true);
    const t0 = performance.now();
    try {
      const result = await searchIndicators({
        q,
        type,
        feedId,
        tag,
        minConfidence: minConfidence ? Number(minConfidence) : undefined,
        page: requestedPage,
      });
      setRows(result.rows);
      setTotal(result.total);
      setPage(result.page);
      setPageSize(result.pageSize);
      setTotalPages(result.totalPages);
      setSearched(true);
      setTookMs(Math.round(performance.now() - t0));
      setSelected(null);
      setDetail(null);
    } catch (error) {
      toast.error("Threat intelligence search failed", {
        description: feedbackError(
          error,
          "Filters were not changed. Try the search again.",
        ),
      });
    } finally {
      setLoading(false);
    }
  }

  const [tookMs, setTookMs] = useState<number | null>(null);

  async function openDetail(value: string) {
    setSelected(value);
    setDetail(null);
    const d = await indicatorDetail(value);
    setDetail(d);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={runSearch} className="kelpie-card p-4 space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Value
            </label>
            <input
              className="kelpie-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="203.0.113.4, evil.example…"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Type
            </label>
            <select
              className="kelpie-input"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t || "any"}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Feed
            </label>
            <select
              className="kelpie-input"
              value={feedId}
              onChange={(e) => setFeedId(e.target.value)}
            >
              <option value="">any</option>
              {feeds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-[minmax(12rem,1fr)_12rem_auto] md:items-end">
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Tag
            </label>
            <input
              className="kelpie-input"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Minimum confidence
            </label>
            <select
              className="kelpie-input"
              value={minConfidence}
              onChange={(event) => setMinConfidence(event.target.value)}
            >
              {CONFIDENCE_THRESHOLDS.map((confidence) => (
                <option key={confidence || "any"} value={confidence}>
                  {confidence ? `${confidence}+` : "any"}
                </option>
              ))}
            </select>
          </div>
          <button className="kelpie-btn kelpie-btn-primary" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {searched ? (
        <p className="text-xs text-slate-500">
          {total === 0
            ? "No results"
            : `Showing ${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} of ${total.toLocaleString()} results`}
          {tookMs !== null ? ` in ${tookMs}ms` : ""}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="kelpie-scroll-x" tabIndex={0}>
            <table className="kelpie-table">
              <thead>
                <tr>
                  <th>Value</th>
                  <th>Type</th>
                  <th>Feed</th>
                  <th>Conf.</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      {searched ? "No matches." : "Search the TI store."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r) => (
                    <tr
                      key={`${r.feedId}-${r.value}-${r.type}`}
                      className="cursor-pointer hover:bg-[color:var(--color-navy-800)]"
                      onClick={() => openDetail(r.value)}
                    >
                      <td className="font-mono text-xs">{r.value}</td>
                      <td className="text-xs text-slate-400">{r.type}</td>
                      <td className="text-xs text-slate-400">{r.feedName}</td>
                      <td>{r.confidence}</td>
                      <td className="text-xs text-slate-400">
                        {r.lastSeen
                          ? new Date(r.lastSeen).toLocaleDateString()
                          : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {searched && totalPages > 1 ? (
            <nav
              className="flex items-center justify-between gap-3"
              aria-label="Threat intelligence result pages"
            >
              <button
                type="button"
                className="kelpie-btn kelpie-btn-secondary"
                disabled={loading || page <= 1}
                onClick={() => runSearch(undefined, page - 1)}
              >
                Previous
              </button>
              <span className="text-xs text-slate-400">
                Page {page.toLocaleString()} of {totalPages.toLocaleString()}
              </span>
              <button
                type="button"
                className="kelpie-btn kelpie-btn-secondary"
                disabled={loading || page >= totalPages}
                onClick={() => runSearch(undefined, page + 1)}
              >
                Next
              </button>
            </nav>
          ) : null}
        </div>

        <aside className="kelpie-card p-4">
          {!selected ? (
            <p className="text-sm text-slate-500">
              Select an indicator to see its feeds and case appearances.
            </p>
          ) : !detail ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-medium text-slate-200 break-all font-mono">
                  {selected}
                </h3>
                <p className="text-xs text-slate-500">
                  Appears in {detail.appearances} case(s)
                </p>
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Feeds
                </h4>
                <ul className="space-y-1 text-xs">
                  {detail.matches.map((m, i) => (
                    <li key={i} className="text-slate-300">
                      {m.feedName}{" "}
                      <span className="text-slate-500">
                        ({m.type}, conf {m.confidence})
                      </span>
                      {m.tags.length > 0 ? (
                        <span className="text-slate-500"> · {m.tags.join(", ")}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4 className="text-xs uppercase tracking-wider text-slate-400 mb-1">
                  Cases
                </h4>
                {detail.cases.length === 0 ? (
                  <p className="text-xs text-slate-500">Not seen on any case.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {detail.cases.map((c) => (
                      <li key={c.id}>
                        <a
                          className="text-[color:var(--color-tan-300)] hover:underline"
                          href={`/cases/${c.id}`}
                        >
                          {c.caseNumber} — {c.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
