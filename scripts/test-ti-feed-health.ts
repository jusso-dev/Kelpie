/**
 * Real-Postgres acceptance coverage for the strict threat-intelligence
 * indicator contract (issue #51): a mixed feed only persists `ip`, `url`,
 * `file_hash`, `domain` rows, every rejected record is counted by reason in
 * feed health, the database itself refuses an unsupported type even if a
 * caller bypasses the application layer, and a retired feed kind (CISA KEV)
 * halts with a precise, actionable error instead of failing opaquely.
 */
import assert from "node:assert/strict";
import http from "node:http";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { organisations, tiFeeds, tiIndicators } from "../src/db/schema";
import { pollFeed } from "../src/lib/ti/core";
import { newId } from "../src/lib/utils";

const runId = newId("tihealth").slice("tihealth_".length).slice(0, 12);
const orgId = `org_tihealth_${runId}`;

const OVERSIZED_VALUE = "a".repeat(2049);

const FIXTURE_LINES = [
  "203.0.113.9,ip",
  "https://evil.example.test/login,url",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,file_hash",
  "evil.example.test,domain",
  "198.51.100.0/24,cidr",
  "CVE-2026-99999,cve",
  "attacker@example.test,email",
  `${OVERSIZED_VALUE},ip`, // non-empty but over the 2048-byte value cap
].join("\n");

async function withFixtureServer<T>(
  body: string,
  fn: (url: string) => Promise<T>,
): Promise<T> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fixture server did not bind a port");
  }
  try {
    return await fn(`http://127.0.0.1:${address.port}/feed.txt`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function main() {
  await db.insert(organisations).values({
    id: orgId,
    name: "TI Health Test Org",
    slug: orgId.replace(/_/g, "-"),
  });

  const previousAllowPrivate = process.env.KELPIE_ALLOW_PRIVATE_NETWORKS;
  process.env.KELPIE_ALLOW_PRIVATE_NETWORKS = "true";

  try {
    // ── 1. Mixed feed: only the four supported types are ingested ────────
    await withFixtureServer(FIXTURE_LINES, async (url) => {
      const feedId = newId("tif");
      await db.insert(tiFeeds).values({
        id: feedId,
        organisationId: orgId,
        name: "Mixed CSV fixture",
        kind: "csv",
        url,
        config: {},
        pollIntervalMinutes: 60,
        isActive: true,
      });

      const result = await pollFeed(feedId);
      assert.equal(result.error, null, "poll of a well-formed feed must not error");
      assert.equal(result.ingested, 4, "only ip/url/file_hash/domain rows are ingested");
      assert.equal(result.skipped, 4, "cidr/cve/email/empty rows are all skipped");
      assert.equal(result.skippedByType.cidr, 1);
      assert.equal(result.skippedByType.cve, 1);
      assert.equal(result.skippedByType.email, 1);
      assert.equal(result.skippedByType.invalid_value, 1);

      const rows = await db
        .select({ type: tiIndicators.type, value: tiIndicators.value })
        .from(tiIndicators)
        .where(eq(tiIndicators.feedId, feedId));
      assert.equal(rows.length, 4);
      const types = new Set(rows.map((r) => r.type));
      assert.deepEqual(
        types,
        new Set(["ip", "url", "file_hash", "domain"]),
        "persisted rows must be exactly the four supported types",
      );
      for (const rejected of ["cidr", "cve", "email"]) {
        assert.ok(
          !rows.some((r) => r.value.toLowerCase().includes(rejected)),
          `no persisted row may reference a rejected ${rejected} value`,
        );
      }

      const [feedRow] = await db
        .select()
        .from(tiFeeds)
        .where(eq(tiFeeds.id, feedId))
        .limit(1);
      assert.equal(feedRow?.indicatorCount, 4);
      assert.equal(feedRow?.lastRunIngestedCount, 4);
      assert.equal(feedRow?.lastRunSkippedCount, 4);
      assert.deepEqual(feedRow?.lastRunSkippedByType, {
        cidr: 1,
        cve: 1,
        email: 1,
        invalid_value: 1,
      });
    });

    // ── 2. Database itself refuses an unsupported type ────────────────────
    const directFeedId = newId("tif");
    await db.insert(tiFeeds).values({
      id: directFeedId,
      organisationId: orgId,
      name: "Direct insert probe",
      kind: "csv",
      url: null,
      config: {},
      pollIntervalMinutes: 60,
      isActive: true,
    });
    await assert.rejects(
      () =>
        db.insert(tiIndicators).values({
          id: newId("tii"),
          organisationId: orgId,
          feedId: directFeedId,
          value: "CVE-2026-1",
          type: "cve",
          confidence: 50,
        }),
      (error: unknown) => {
        const cause = error instanceof Error ? error.cause : undefined;
        const causeMessage = cause instanceof Error ? cause.message : "";
        return causeMessage.includes("ti_indicators_type_allowlist");
      },
      "the type allowlist CHECK constraint must reject an unsupported type even bypassing application validation",
    );

    // ── 3. Retired feed kind halts with a precise, actionable reason ──────
    const retiredFeedId = newId("tif");
    await db.insert(tiFeeds).values({
      id: retiredFeedId,
      organisationId: orgId,
      name: "Legacy CISA KEV feed",
      kind: "cisa_kev",
      url: "https://cisa.example.test/kev.json",
      config: {},
      pollIntervalMinutes: 360,
      isActive: true,
    });
    const retiredResult = await pollFeed(retiredFeedId);
    assert.equal(retiredResult.ingested, 0);
    assert.match(
      retiredResult.error ?? "",
      /CISA Known Exploited Vulnerabilities was retired/,
      "a retired feed kind must halt with a specific, actionable message",
    );
    const [retiredFeedRow] = await db
      .select({ isActive: tiFeeds.isActive, lastError: tiFeeds.lastError })
      .from(tiFeeds)
      .where(eq(tiFeeds.id, retiredFeedId))
      .limit(1);
    assert.equal(retiredFeedRow?.isActive, false, "a retired feed kind must be deactivated");
    assert.ok(retiredFeedRow?.lastError, "a retired feed kind must record lastError");
    const orphanIndicators = await db
      .select({ id: tiIndicators.id })
      .from(tiIndicators)
      .where(eq(tiIndicators.feedId, retiredFeedId));
    assert.equal(orphanIndicators.length, 0, "a retired feed kind must not ingest any indicators");

    console.log("TI feed health tests passed");
  } finally {
    if (previousAllowPrivate === undefined) {
      delete process.env.KELPIE_ALLOW_PRIVATE_NETWORKS;
    } else {
      process.env.KELPIE_ALLOW_PRIVATE_NETWORKS = previousAllowPrivate;
    }
    const orgFeeds = await db
      .select({ id: tiFeeds.id })
      .from(tiFeeds)
      .where(eq(tiFeeds.organisationId, orgId));
    for (const feed of orgFeeds) {
      await db.delete(tiIndicators).where(eq(tiIndicators.feedId, feed.id));
    }
    await db.delete(tiFeeds).where(eq(tiFeeds.organisationId, orgId));
    await db.delete(organisations).where(and(eq(organisations.id, orgId)));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
