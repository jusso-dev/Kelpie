import type { TiFeedHandler } from "./types";
import { csvFeed } from "./handlers/csv";
import { mispFeed } from "./handlers/misp";
import { otxFeed } from "./handlers/otx";

const FEEDS: TiFeedHandler[] = [csvFeed, mispFeed, otxFeed];

export function listFeedHandlers(): TiFeedHandler[] {
  return FEEDS;
}

export function getFeedHandler(kind: string): TiFeedHandler | null {
  return FEEDS.find((f) => f.kind === kind) ?? null;
}
