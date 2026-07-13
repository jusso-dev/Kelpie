import type { TiFeedHandler } from "../types";
import { normaliseType } from "../normalise";
import { safeFetch } from "@/lib/outbound-request";

/**
 * Generic CSV / TXT feed: one indicator per line. Lines may be a bare value or
 * `value,type`. Comment lines starting with # are ignored.
 */
export const csvFeed: TiFeedHandler = {
  kind: "csv",
  label: "CSV / TXT feed",
  description: "Poll a plain URL with one indicator per line (value or value,type).",
  configFields: [
    {
      key: "default_type",
      label: "Default type",
      type: "string",
      required: false,
      placeholder: "ip, domain, url, file_hash (blank = auto-detect)",
    },
  ],
  async fetchIndicators({ url, config }) {
    if (!url) throw new Error("CSV feed needs a URL");
    const defaultType = String(config.default_type ?? "").trim();
    const res = await safeFetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
    const text = await res.text();
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split(",").map((p) => p.trim());
      const value = parts[0];
      if (!value) continue;
      const rawType = parts[1] ?? defaultType;
      out.push({ value, type: normaliseType(rawType, value), confidence: 50 });
    }
    return out;
  },
};
