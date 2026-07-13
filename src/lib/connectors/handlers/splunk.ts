import type { Connector } from "../types";
import { safeFetch } from "@/lib/outbound-request";

/**
 * Polls one or more Splunk saved searches via the REST search jobs API and
 * returns the result rows. Cursor is the latest `_time` seen, so subsequent
 * polls only fetch newer events.
 */
export const splunkConnector: Connector = {
  kind: "splunk",
  label: "Splunk",
  description: "Poll Splunk saved searches and turn each result into an alert.",
  configFields: [
    {
      key: "base_url",
      label: "Base URL",
      type: "string",
      required: true,
      placeholder: "https://splunk.example.com:8089",
    },
    { key: "token", label: "Auth token", type: "password", required: true },
    {
      key: "saved_searches",
      label: "Saved searches",
      type: "string",
      required: true,
      placeholder: "comma separated saved search names",
    },
  ],
  defaultMapping: {
    title: "search_name",
    description: "_raw",
    severity: "severity",
    severityMap: { informational: "low", low: "low", medium: "medium", high: "high", critical: "critical" },
    externalRef: "event_id",
    observables: [
      { type: "ip", path: "src_ip" },
      { type: "username", path: "user" },
      { type: "hostname", path: "dest" },
    ],
  },
  async poll({ config, cursor }) {
    const base = String(config.base_url ?? "").replace(/\/$/, "");
    const token = String(config.token ?? "");
    const searches = String(config.saved_searches ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!base || !token || searches.length === 0) {
      throw new Error("Splunk connector is not fully configured");
    }
    const earliest = cursor || "-15m";
    const records: Array<Record<string, unknown>> = [];
    let latest = cursor;
    for (const search of searches) {
      const params = new URLSearchParams({
        search: `| savedsearch "${search}"`,
        output_mode: "json",
        earliest_time: earliest,
        exec_mode: "oneshot",
        count: "200",
      });
      const res = await safeFetch(`${base}/services/search/jobs/export`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        throw new Error(`Splunk HTTP ${res.status} for search "${search}"`);
      }
      const text = await res.text();
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { result?: Record<string, unknown> };
          if (parsed.result) {
            const r: Record<string, unknown> = {
              ...parsed.result,
              search_name: search,
            };
            records.push(r);
            const t = r._time;
            if (typeof t === "string" && (!latest || t > latest)) latest = t;
          }
        } catch {
          // Skip non-JSON lines (Splunk emits status preamble).
        }
      }
    }
    return { records, nextCursor: latest };
  },
};
