import type { TiFeedHandler } from "../types";
import { createIndicatorCollector } from "../collect";
import { safeFetch } from "@/lib/outbound-request";

function firstCsvField(line: string): string {
  if (!line.startsWith('"')) return line.split(",", 1)[0]?.trim() ?? "";
  const end = line.indexOf('",', 1);
  return (end === -1 ? line.slice(1, -1) : line.slice(1, end)).replace(/""/g, '"');
}

export const phishTankFeed: TiFeedHandler = {
  kind: "phishtank",
  label: "PhishTank valid phishing URLs",
  description: "Poll PhishTank's online-valid CSV and ingest its URL column.",
  configFields: [],
  async fetchIndicators({ url }) {
    if (!url) throw new Error("PhishTank feed needs a URL");
    const requestHeaders = { "User-Agent": "Kelpie/0.2 threat-intelligence" };
    let res = await safeFetch(url, {
      headers: requestHeaders,
      signal: AbortSignal.timeout(30000),
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error(`Feed HTTP ${res.status} without Location`);
      res = await safeFetch(new URL(location, url), {
        headers: requestHeaders,
        signal: AbortSignal.timeout(30000),
      });
    }
    if (!res.ok) throw new Error(`Feed HTTP ${res.status}`);
    const lines = (await res.text()).split(/\r?\n/).filter(Boolean);
    const collector = createIndicatorCollector();
    if (lines.length === 0) return collector.result();
    const headers = lines[0].split(",").map((field) => field.replaceAll('"', "").trim());
    const urlIndex = headers.indexOf("url");
    if (urlIndex < 0) throw new Error("PhishTank CSV has no URL column");

    for (const line of lines.slice(1)) {
      // The public feed currently places URL second. Parse the common fast path,
      // while retaining quoted URL support.
      const remainder = line.slice(line.indexOf(",") + 1);
      const value = urlIndex === 0 ? firstCsvField(line) : firstCsvField(remainder);
      if (!value) continue;
      // Still routed through the collector so a non-URL row is skipped and
      // counted rather than force-labelled `url`.
      collector.add({
        value,
        rawType: "url",
        confidence: 80,
        tags: ["phishing", "phishtank", "osint"],
      });
    }
    return collector.result();
  },
};
