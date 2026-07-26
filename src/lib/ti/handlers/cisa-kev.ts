import type { TiFeedHandler } from "../types";
import { safeFetch } from "@/lib/outbound-request";

type KevItem = {
  cveID?: unknown;
  vendorProject?: unknown;
  product?: unknown;
  vulnerabilityName?: unknown;
  dateAdded?: unknown;
  dueDate?: unknown;
  knownRansomwareCampaignUse?: unknown;
};

export const cisaKevFeed: TiFeedHandler = {
  kind: "cisa_kev",
  label: "CISA Known Exploited Vulnerabilities",
  description: "Poll CISA's KEV JSON catalogue and ingest each CVE.",
  configFields: [],
  async fetchIndicators({ url }) {
    if (!url) throw new Error("CISA KEV feed needs a URL");
    const res = await safeFetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
    const data = (await res.json()) as { vulnerabilities?: unknown };
    if (!Array.isArray(data.vulnerabilities)) {
      throw new Error("CISA KEV response has no vulnerabilities array");
    }
    return (data.vulnerabilities as KevItem[])
      .filter((item) => typeof item.cveID === "string" && item.cveID)
      .map((item) => ({
        value: String(item.cveID).toUpperCase(),
        type: "cve",
        confidence: 90,
        tags: [
          "known-exploited",
          "cisa-kev",
          ...(item.knownRansomwareCampaignUse === "Known"
            ? ["ransomware"]
            : []),
        ],
        attributes: {
          vendor: item.vendorProject,
          product: item.product,
          name: item.vulnerabilityName,
          date_added: item.dateAdded,
          due_date: item.dueDate,
        },
      }));
  },
};
