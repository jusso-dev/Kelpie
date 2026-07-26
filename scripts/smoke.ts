/**
 * Basic case-management API smoke test against a running seeded Kelpie.
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
  if (!org) throw new Error("Seed data missing: run npm run db:seed first.");
  const { plaintext, hash } = generateApiToken();
  await db.insert(apiTokens).values({
    id: newId("tok"),
    organisationId: org.id,
    name: "smoke-test",
    tokenHash: hash,
    scopes: ["cases:write", "cases:read"],
  });
  return plaintext;
}

async function main() {
  console.log(`Smoke testing against ${BASE}`);
  const token = await ensureSmokeToken();

  console.log("1) POST /api/v1/cases");
  const post = await fetch(`${BASE}/api/v1/cases`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      title: "Smoke test case",
      summary: "Created by scripts/smoke.ts",
      severity: "low",
      classification: "other",
      tags: ["smoke-test"],
    }),
  });
  if (!post.ok) throw new Error(`POST failed ${post.status}: ${await post.text()}`);
  const created = (await post.json()) as { id: string; caseNumber: string };
  console.log(`   created ${created.caseNumber}`);

  console.log("2) GET /api/v1/cases");
  const list = await fetch(`${BASE}/api/v1/cases`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!list.ok) throw new Error(`GET failed ${list.status}`);
  const { cases } = (await list.json()) as { cases: Array<{ id: string }> };
  if (!cases.some((item) => item.id === created.id)) {
    throw new Error("Created case not returned by GET");
  }
  console.log(`   listed ${cases.length} cases; created case present`);
  console.log("Smoke OK.");
}

main().catch((error) => {
  console.error("Smoke FAILED:", error);
  process.exit(1);
});
