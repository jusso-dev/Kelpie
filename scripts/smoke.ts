/**
 * Smoke test for the Phase 1 MVP.
 *
 * Exercises the key paths against a running Kelpie instance with seeded data:
 *   1. Create an API token via the admin sign-in.
 *   2. Push an alert through POST /api/v1/alerts.
 *   3. Read it back through GET /api/v1/alerts.
 *
 * Run after `npm run db:migrate && npm run db:seed && npm run dev`:
 *   npm run smoke
 */

import { generateApiToken } from "../src/lib/api-tokens";
import { db } from "../src/db";
import { apiTokens, organisations } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { newId } from "../src/lib/utils";

const BASE = process.env.APP_URL ?? "http://localhost:3000";

async function ensureSmokeToken() {
  const [org] = await db
    .select()
    .from(organisations)
    .where(eq(organisations.slug, "acme-soc"))
    .limit(1);
  if (!org) {
    throw new Error("Seed data missing: run npm run db:seed first.");
  }
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    organisationId: org.id,
    name: "smoke-test",
    tokenHash: hash,
    scopes: ["alerts:write", "alerts:read"],
  });
  return plaintext;
}

async function main() {
  console.log(`Smoke testing against ${BASE}`);
  const token = await ensureSmokeToken();

  console.log("1) POST /api/v1/alerts");
  const post = await fetch(`${BASE}/api/v1/alerts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: "Smoke test alert",
      description: "Posted by scripts/smoke.ts",
      severity: "low",
      source: "smoke-test",
      externalRef: `smoke-${Date.now()}`,
      observables: [{ type: "ip", value: "192.0.2.123" }],
    }),
  });
  if (!post.ok) {
    const text = await post.text();
    throw new Error(`POST failed ${post.status}: ${text}`);
  }
  const created = (await post.json()) as { id: string };
  console.log(`   created alert ${created.id}`);

  console.log("2) GET /api/v1/alerts");
  const list = await fetch(`${BASE}/api/v1/alerts`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok) {
    throw new Error(`GET failed ${list.status}`);
  }
  const { alerts: rows } = (await list.json()) as { alerts: Array<{ id: string }> };
  if (!rows.some((r) => r.id === created.id)) {
    throw new Error("Created alert not returned by GET");
  }
  console.log(`   listed ${rows.length} alerts, includes the new one ✓`);

  console.log("Smoke OK.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Smoke FAILED:", err);
  process.exit(1);
});
