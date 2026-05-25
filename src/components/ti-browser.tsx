"use client";

import { useState } from "react";
import {
  indicatorDetail,
  searchIndicators,
  type IndicatorSearchRow,
} from "@/actions/ti";

type Detail = Awaited<ReturnType<typeof indicatorDetail>>;

const TYPES = ["", "ip", "domain", "url", "file_hash", "email", "other"];

export default function TiBrowser({
  feeds,
}: {
  feeds: Array<{ id: string; name: string }>;
}) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [feedId, setFeedId] = useState("");
  const [tag, setTag] = useState("");
  const [rows, setRows] = useState<IndicatorSearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    const t0 = performance.now();
    try {
      const res = await searchIndicators({ q, type, feedId, tag });
      setRows(res);
      setSearched(true);
      setTookMs(Math.round(performance.now() - t0));
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
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs uppercase tracking-wider text-slate-400 mb-1">
              Tag
            </label>
            <input
              className="kelpie-input"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
            />
          </div>
          <button className="kelpie-btn kelpie-btn-primary" disabled={loading}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>
      </form>

      {searched ? (
        <p className="text-xs text-slate-500">
          {rows.length} result(s){tookMs !== null ? ` in ${tookMs}ms` : ""}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 kelpie-scroll-x" tabIndex={0}>
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
                  <td colSpan={5} className="text-center text-slate-500 py-6">
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
                      {r.lastSeen ? new Date(r.lastSeen).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
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
