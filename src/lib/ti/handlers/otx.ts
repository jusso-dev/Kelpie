import type { TiFeedHandler } from "../types";
import { createIndicatorCollector } from "../collect";

/** AlienVault OTX subscribed pulses. */
export const otxFeed: TiFeedHandler = {
  kind: "otx",
  label: "AlienVault OTX",
  description: "Pull indicators from your subscribed OTX pulses.",
  configFields: [
    { key: "api_key", label: "OTX API key", type: "password", required: true },
  ],
  async fetchIndicators({ config }) {
    const apiKey = String(config.api_key ?? "");
    if (!apiKey) throw new Error("OTX feed needs an API key");
    const res = await fetch(
      "https://otx.alienvault.com/api/v1/pulses/subscribed?limit=50",
      {
        headers: { "X-OTX-API-KEY": apiKey },
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!res.ok) throw new Error(`OTX HTTP ${res.status}`);
    const json = (await res.json()) as {
      results?: Array<{
        name?: string;
        tags?: string[];
        indicators?: Array<{ indicator?: string; type?: string }>;
      }>;
    };
    const collector = createIndicatorCollector();
    for (const pulse of json.results ?? []) {
      for (const ind of pulse.indicators ?? []) {
        collector.add({
          value: String(ind.indicator ?? ""),
          rawType: String(ind.type ?? ""),
          confidence: 65,
          tags: pulse.tags ?? [],
          attributes: { pulse: pulse.name },
        });
      }
    }
    return collector.result();
  },
};
