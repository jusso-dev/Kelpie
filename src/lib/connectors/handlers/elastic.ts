import type { Connector } from "../types";
import { safeFetch } from "@/lib/outbound-request";

/**
 * Polls Elastic Security detection signals via the signals search API. Cursor
 * is the latest `@timestamp` seen.
 */
export const elasticConnector: Connector = {
  kind: "elastic",
  label: "Elastic Security",
  description: "Poll Elastic Security detection signals into alerts.",
  configFields: [
    {
      key: "cloud_url",
      label: "Kibana / Elastic URL",
      type: "string",
      required: true,
      placeholder: "https://my-deployment.kb.cloud.es.io",
    },
    { key: "api_key", label: "API key", type: "password", required: true },
    {
      key: "index_pattern",
      label: "Signals index",
      type: "string",
      required: false,
      placeholder: ".siem-signals-default",
    },
  ],
  defaultMapping: {
    title: "signal.rule.name",
    description: "signal.rule.description",
    severity: "signal.rule.severity",
    severityMap: { low: "low", medium: "medium", high: "high", critical: "critical" },
    externalRef: "_id",
    observables: [
      { type: "ip", path: "source.ip" },
      { type: "hostname", path: "host.name" },
      { type: "username", path: "user.name" },
    ],
  },
  async poll({ config, cursor }) {
    const base = String(config.cloud_url ?? "").replace(/\/$/, "");
    const apiKey = String(config.api_key ?? "");
    const index = String(config.index_pattern ?? ".siem-signals-default");
    if (!base || !apiKey) {
      throw new Error("Elastic connector is not fully configured");
    }
    const gte = cursor || "now-15m";
    const body = {
      size: 200,
      sort: [{ "@timestamp": "asc" }],
      query: {
        bool: {
          filter: [{ range: { "@timestamp": { gt: gte } } }],
        },
      },
    };
    const res = await safeFetch(`${base}/${encodeURIComponent(index)}/_search`, {
      method: "POST",
      headers: {
        Authorization: `ApiKey ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      throw new Error(`Elastic HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      hits?: { hits?: Array<{ _id: string; _source: Record<string, unknown> }> };
    };
    const hits = json.hits?.hits ?? [];
    let latest = cursor;
    const records = hits.map((h) => {
      const ts = (h._source as { ["@timestamp"]?: string })["@timestamp"];
      if (typeof ts === "string" && (!latest || ts > latest)) latest = ts;
      return { _id: h._id, ...h._source };
    });
    return { records, nextCursor: latest };
  },
};
