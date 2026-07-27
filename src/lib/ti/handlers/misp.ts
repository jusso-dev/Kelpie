import type { TiFeedHandler } from "../types";
import { createIndicatorCollector } from "../collect";
import { safeFetch } from "@/lib/outbound-request";

/** MISP attribute search via the REST API. */
export const mispFeed: TiFeedHandler = {
  kind: "misp",
  label: "MISP",
  description: "Pull attributes from a MISP instance via /attributes/restSearch.",
  configFields: [
    { key: "api_key", label: "API key", type: "password", required: true },
    {
      key: "last",
      label: "Lookback window",
      type: "string",
      required: false,
      placeholder: "7d",
      help: "MISP `last` window, e.g. 1d, 7d, 30d.",
    },
  ],
  async fetchIndicators({ url, config }) {
    if (!url) throw new Error("MISP feed needs a base URL");
    const apiKey = String(config.api_key ?? "");
    if (!apiKey) throw new Error("MISP feed needs an API key");
    const last = String(config.last ?? "7d");
    const res = await safeFetch(`${url.replace(/\/$/, "")}/attributes/restSearch`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ returnFormat: "json", last, to_ids: true }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`MISP HTTP ${res.status}`);
    const json = (await res.json()) as {
      response?: { Attribute?: Array<Record<string, unknown>> };
    };
    const attrs = json.response?.Attribute ?? [];
    const collector = createIndicatorCollector();
    for (const a of attrs) {
      const tags = Array.isArray(a.Tag)
        ? (a.Tag as Array<{ name?: string }>)
            .map((t) => t.name)
            .filter((n): n is string => Boolean(n))
        : [];
      collector.add({
        value: String(a.value ?? ""),
        rawType: String(a.type ?? ""),
        confidence: 70,
        tags,
        attributes: { category: a.category, event_id: a.event_id },
      });
    }
    return collector.result();
  },
};
