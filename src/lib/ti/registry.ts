import type { TiFeedHandler } from "./types";
import { csvFeed } from "./handlers/csv";
import { mispFeed } from "./handlers/misp";
import { otxFeed } from "./handlers/otx";
import { phishTankFeed } from "./handlers/phishtank";

const FEEDS: TiFeedHandler[] = [csvFeed, phishTankFeed, mispFeed, otxFeed];

export function listFeedHandlers(): TiFeedHandler[] {
  return FEEDS;
}

export function getFeedHandler(kind: string): TiFeedHandler | null {
  return FEEDS.find((f) => f.kind === kind) ?? null;
}

/**
 * Feed kinds that used to exist but are incompatible with the strict
 * indicator contract (`ip`, `url`, `file_hash`, `domain`). Kept so existing
 * tenant rows get a precise halt reason instead of a generic "unknown kind".
 */
export const RETIRED_FEED_KINDS: Readonly<Record<string, string>> = {
  cisa_kev:
    "CISA Known Exploited Vulnerabilities was retired: CVE records are not threat-intelligence indicators.",
};

export function retiredFeedKindReason(kind: string): string | null {
  return RETIRED_FEED_KINDS[kind] ?? null;
}
