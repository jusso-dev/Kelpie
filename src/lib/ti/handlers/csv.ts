import type { TiFeedHandler } from "../types";
import { createIndicatorCollector } from "../collect";
import { safeFetch } from "@/lib/outbound-request";

/**
 * Generic CSV / TXT feed: one indicator per line. Lines may be a bare value or
 * `value,type`. Comment lines starting with # are ignored.
 */
export const csvFeed: TiFeedHandler = {
  kind: "csv",
  label: "CSV / TXT feed",
  description:
    "Poll a plain URL with one indicator per line (value or value,type). Only supported indicator types are ingested; other rows are skipped.",
  configFields: [
    {
      key: "default_type",
      label: "Default type",
      type: "string",
      required: false,
      placeholder: "ip, url, file_hash, domain (blank = auto-detect)",
      help: "Unsupported types such as CIDR ranges, CVEs and email addresses are skipped and counted in feed health.",
    },
    {
      key: "default_tags",
      label: "Default tags",
      type: "string",
      required: false,
      placeholder: "osint, phishing",
    },
  ],
  async fetchIndicators({ url, config }) {
    if (!url) throw new Error("CSV feed needs a URL");
    const defaultType = String(config.default_type ?? "").trim();
    const defaultTags = String(config.default_tags ?? "")
      .split(",")
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
    const res = await safeFetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
    const text = await res.text();
    const collector = createIndicatorCollector();
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const uncommented = trimmed.split(/\s*;\s*/, 1)[0]?.trim() ?? "";
      const parts = uncommented.split(",").map((p) => p.trim());
      const value = parts[0];
      if (!value) continue;
      collector.add({
        value,
        rawType: parts[1] ?? defaultType,
        confidence: 50,
        tags: defaultTags,
      });
    }
    return collector.result();
  },
};
