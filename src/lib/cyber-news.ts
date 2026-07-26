import { XMLParser } from "fast-xml-parser";

export type CyberNewsItem = {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string | null;
};

export type CyberNewsResult = {
  items: CyberNewsItem[];
  failedSources: string[];
  refreshedAt: string;
};

const SOURCES = [
  {
    name: "ASD's ACSC Advisories",
    feedUrl: "https://www.cyber.gov.au/rss/advisories",
    homeUrl:
      "https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories",
  },
  {
    name: "ASD's ACSC Alerts",
    feedUrl: "https://www.cyber.gov.au/rss/alerts",
    homeUrl:
      "https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories",
  },
  {
    name: "ASD's ACSC News",
    feedUrl: "https://www.cyber.gov.au/rss/news",
    homeUrl: "https://www.cyber.gov.au/about-us/view-all-content/news",
  },
  {
    name: "Scamwatch",
    feedUrl: "https://www.scamwatch.gov.au/rss/news-feed.xml",
    homeUrl: "https://www.scamwatch.gov.au/about-us/news-and-alerts",
  },
  {
    name: "CISA",
    feedUrl: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
    homeUrl: "https://www.cisa.gov/news-events/cybersecurity-advisories",
  },
  {
    name: "UK NCSC",
    feedUrl: "https://www.ncsc.gov.uk/api/1/services/v1/all-rss-feed.xml",
    homeUrl: "https://www.ncsc.gov.uk/section/keep-up-to-date/all-articles",
  },
  {
    name: "CERT-EU",
    feedUrl: "https://cert.europa.eu/publications/threat-intelligence-rss",
    homeUrl: "https://cert.europa.eu/publications/threat-intelligence/",
  },
] as const;

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
  htmlEntities: true,
  maxNestedTags: 100,
  processEntities: {
    enabled: true,
    maxEntityCount: 50,
    maxExpandedLength: 50_000,
  },
});

function record(value: unknown): XmlRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlRecord)
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  const object = record(value);
  return text(object["#text"]);
}

function items(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (match, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower === "amp") return "&";
      if (lower === "lt") return "<";
      if (lower === "gt") return ">";
      if (lower === "quot") return '"';
      if (lower === "apos") return "'";
      if (lower === "nbsp") return " ";
      const codePoint = lower.startsWith("#x")
        ? Number.parseInt(lower.slice(2), 16)
        : Number.parseInt(lower.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    },
  );
}

function stripMarkup(value: string): string {
  return decodeEntities(decodeEntities(value))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function safeArticleUrl(value: string, sourceHost: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (
      url.hostname !== sourceHost &&
      !url.hostname.endsWith(`.${sourceHost}`)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function atomLink(value: unknown): string {
  const candidates = items(value);
  for (const candidate of candidates) {
    if (typeof candidate === "string") return candidate.trim();
    const link = record(candidate);
    const relation = text(link["@_rel"]);
    const href = text(link["@_href"]);
    if (href && (!relation || relation === "alternate")) return href;
  }
  return "";
}

function parseFeed(
  xml: string,
  source: (typeof SOURCES)[number],
): CyberNewsItem[] {
  const parsed = record(parser.parse(xml));
  const rssChannel = record(record(parsed.rss).channel);
  const atomFeed = record(parsed.feed);
  const entries = rssChannel.item
    ? items(rssChannel.item)
    : items(atomFeed.entry);
  const sourceHost = new URL(source.homeUrl).hostname;

  return entries.flatMap((entryValue, index) => {
    const entry = record(entryValue);
    const title = stripMarkup(text(entry.title));
    const rawLink = text(entry.link) || atomLink(entry.link);
    const url = safeArticleUrl(rawLink, sourceHost);
    if (!title || !url) return [];
    const rawDate =
      text(entry.pubDate) ||
      text(entry.published) ||
      text(entry.updated) ||
      text(entry.date);
    const date = rawDate ? new Date(rawDate) : null;
    const publishedAt =
      date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    const summary = stripMarkup(
      text(entry.description) || text(entry.summary) || text(entry.content),
    );
    return [
      {
        id: `${source.name}:${text(entry.guid) || text(entry.id) || url || index}`,
        source: source.name,
        sourceUrl: source.homeUrl,
        title,
        url,
        summary,
        publishedAt,
      },
    ];
  });
}

async function fetchSource(
  source: (typeof SOURCES)[number],
): Promise<CyberNewsItem[]> {
  const response = await fetch(source.feedUrl, {
    headers: {
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
      "accept-encoding": "identity",
      "user-agent": "Kelpie/0.2",
    },
    next: { revalidate: 900 },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${source.name} returned HTTP ${response.status}`);
  }
  const xml = await response.text();
  if (xml.length > 2_000_000) {
    throw new Error(`${source.name} feed is unexpectedly large`);
  }
  return parseFeed(xml, source);
}

export async function getCyberNews(): Promise<CyberNewsResult> {
  const settled = await Promise.allSettled(SOURCES.map(fetchSource));
  const failedSources: string[] = [];
  const deduplicated = new Map<string, CyberNewsItem>();

  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      failedSources.push(SOURCES[index].name);
      return;
    }
    for (const item of result.value) {
      if (!deduplicated.has(item.url)) deduplicated.set(item.url, item);
    }
  });

  const items = [...deduplicated.values()]
    .sort((a, b) => {
      const aDate = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const bDate = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return bDate - aDate;
    })
    .slice(0, 240);

  return { items, failedSources, refreshedAt: new Date().toISOString() };
}

export const CYBER_NEWS_SOURCES = SOURCES;
