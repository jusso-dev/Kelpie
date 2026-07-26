import { db } from "@/db";
import { tiFeeds } from "@/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "@/lib/utils";

export type StarterTiFeed = {
  name: string;
  kind: string;
  url: string;
  config: Record<string, string>;
  pollIntervalMinutes: number;
  isActive: boolean;
};

// Kept in step with the public starter sources used by jusso-dev/Tawny-SOC.
export const STARTER_TI_FEEDS: readonly StarterTiFeed[] = [
  {
    name: "Feodo Tracker Botnet C2 IPs",
    kind: "csv",
    url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt",
    config: { default_type: "ip", default_tags: "botnet-c2,osint" },
    pollIntervalMinutes: 60,
    isActive: true,
  },
  {
    name: "Spamhaus DROP Rogue Networks",
    kind: "csv",
    url: "https://www.spamhaus.org/drop/drop.txt",
    config: { default_type: "cidr", default_tags: "rogue-network,osint" },
    pollIntervalMinutes: 360,
    isActive: true,
  },
  {
    name: "CISA Known Exploited Vulnerabilities",
    kind: "cisa_kev",
    url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json",
    config: {},
    pollIntervalMinutes: 360,
    isActive: true,
  },
  {
    name: "OpenPhish Community Phishing URLs",
    kind: "csv",
    url: "https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt",
    config: { default_type: "url", default_tags: "phishing,osint" },
    pollIntervalMinutes: 60,
    isActive: true,
  },
  {
    name: "PhishTank Online Valid Phishing URLs",
    kind: "phishtank",
    url: "https://data.phishtank.com/data/online-valid.csv",
    config: {},
    pollIntervalMinutes: 120,
    isActive: false,
  },
  {
    name: "Emerging Threats Compromised IPs",
    kind: "csv",
    url: "https://rules.emergingthreats.net/blockrules/compromised-ips.txt",
    config: { default_type: "ip", default_tags: "compromised-host,osint" },
    pollIntervalMinutes: 120,
    isActive: false,
  },
  {
    name: "Blocklist.de Recent Attackers",
    kind: "csv",
    url: "https://lists.blocklist.de/lists/all.txt",
    config: { default_type: "ip", default_tags: "recent-attacker,osint" },
    pollIntervalMinutes: 60,
    isActive: false,
  },
] as const;

export async function seedStarterThreatFeeds(
  organisationId: string,
  createdBy: string | null,
): Promise<number> {
  const existing = await db
    .select({ url: tiFeeds.url })
    .from(tiFeeds)
    .where(eq(tiFeeds.organisationId, organisationId));
  const existingUrls = new Set(existing.map((feed) => feed.url).filter(Boolean));
  const missing = STARTER_TI_FEEDS.filter((feed) => !existingUrls.has(feed.url));
  if (missing.length === 0) return 0;

  await db.insert(tiFeeds).values(
    missing.map((feed) => ({
      id: newId("tif"),
      organisationId,
      createdBy,
      ...feed,
    })),
  );
  return missing.length;
}
