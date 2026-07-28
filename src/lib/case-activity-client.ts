/**
 * Pure, isomorphic helpers for the case-activity realtime channel. This file
 * must stay free of server-only imports (no `@/db`) because it is imported
 * directly by the client-side collaboration provider.
 */

/** Envelope describing a single case-activity event delivered over the channel. */
export type CaseActivityEnvelope = {
  id: string;
  type: string;
  occurredAt: string;
  actorId: string | null;
};

export type ActivityFoldState = {
  seenIds: ReadonlySet<string>;
  cursor: string | null;
};

/** Bound on the client-side id cache so a long-lived tab never grows it forever. */
const SEEN_ID_CAP = 500;

/**
 * Folds a batch of activity envelopes into a bounded id cache and a
 * monotonic cursor. Safe to call repeatedly with overlapping, duplicated, or
 * out-of-order batches: already-seen ids are dropped and the cursor never
 * moves backwards. A caller that only reacts to `fresh.length > 0` (for
 * example by re-fetching authoritative state) can never have its local state
 * corrupted by replayed, duplicated, or re-ordered delivery, because the
 * fold is idempotent and the reaction to it is itself a full refetch rather
 * than an incremental patch.
 */
export function foldActivity(
  state: ActivityFoldState,
  events: readonly CaseActivityEnvelope[],
): { fresh: CaseActivityEnvelope[]; seenIds: Set<string>; cursor: string | null } {
  const seenIds = new Set(state.seenIds);
  const fresh: CaseActivityEnvelope[] = [];
  let cursor = state.cursor;

  for (const event of events) {
    if (seenIds.has(event.id)) continue;
    seenIds.add(event.id);
    fresh.push(event);
    if (!cursor || event.occurredAt > cursor) {
      cursor = event.occurredAt;
    }
  }

  if (seenIds.size > SEEN_ID_CAP) {
    const overflow = seenIds.size - SEEN_ID_CAP;
    const oldest = Array.from(seenIds).slice(0, overflow);
    for (const id of oldest) seenIds.delete(id);
  }

  return { fresh, seenIds, cursor };
}

export type ConnectionStatus = "connecting" | "live" | "reconnecting" | "stale";

/**
 * Exponential backoff with a cap, used for manual EventSource reconnects so
 * repeated failures do not hammer the server. Deterministic given `attempt`;
 * jitter is applied by the caller if desired.
 */
export function reconnectDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
  return base;
}
