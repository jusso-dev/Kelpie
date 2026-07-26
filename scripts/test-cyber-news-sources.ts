import assert from "node:assert/strict";
import { CYBER_NEWS_SOURCES } from "../src/lib/cyber-news";

const expectedAustralianSources = new Map([
  ["ASD's ACSC Advisories", "https://www.cyber.gov.au/rss/advisories"],
  ["ASD's ACSC Alerts", "https://www.cyber.gov.au/rss/alerts"],
  ["ASD's ACSC News", "https://www.cyber.gov.au/rss/news"],
  ["Scamwatch", "https://www.scamwatch.gov.au/rss/news-feed.xml"],
]);

for (const [name, feedUrl] of expectedAustralianSources) {
  const source = CYBER_NEWS_SOURCES.find((candidate) => candidate.name === name);
  assert.equal(source?.feedUrl, feedUrl);
  assert.equal(new URL(source?.homeUrl ?? "").protocol, "https:");
}

assert.equal(
  new Set(CYBER_NEWS_SOURCES.map((source) => source.feedUrl)).size,
  CYBER_NEWS_SOURCES.length,
);

console.log("cyber news sources passed");
