import type { TiFeedHandler } from "./types";
import { csvFeed } from "./handlers/csv";
import { cisaKevFeed } from "./handlers/cisa-kev";
import { mispFeed } from "./handlers/misp";
import { otxFeed } from "./handlers/otx";
import { phishTankFeed } from "./handlers/phishtank";

const FEEDS: TiFeedHandler[] = [
  csvFeed,
  cisaKevFeed,
  phishTankFeed,
  mispFeed,
  otxFeed,
];

export function listFeedHandlers(): TiFeedHandler[] {
  return FEEDS;
}

export function getFeedHandler(kind: string): TiFeedHandler | null {
  return FEEDS.find((f) => f.kind === kind) ?? null;
}
