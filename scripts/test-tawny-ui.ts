/**
 * UI-level acceptance coverage for issue #50: Tawny-sourced cases must show
 * accurate provenance in the browser, not fall through to the Microsoft
 * Sentinel label, never render an unsafe `source_url` as a clickable link,
 * and be filterable from the case queue and discoverable from the
 * integrations settings page.
 *
 * This script assumes a seeded database and a running app (see
 * `scripts/test-case-queue.ts`, whose structure and login helper it mirrors).
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { cases, organisations, timelineEvents } from "../src/db/schema";
import { createCaseCore } from "../src/lib/cases-core";
import { newId } from "../src/lib/utils";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

const runId = newId("tawnyui").slice("tawnyui_".length).slice(0, 12);

async function main() {
  const [organisation] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "acme-soc"))
    .limit(1);
  assert.ok(organisation, "seed the test database first");

  const sourceReference = `tawny-ui-${runId}`;
  const sourceUrl = `https://tawny.example.com/alerts/${runId}`;
  const { id: caseId, caseNumber } = await createCaseCore(organisation.id, null, {
    title: "Tawny UI provenance fixture case",
    sourceSystem: "tawny",
    sourceReference,
    sourceUrl,
  });

  const unsafeCaseId = newId("case");
  await db.insert(cases).values({
    id: unsafeCaseId,
    organisationId: organisation.id,
    caseNumber: `TAWNY-UI-UNSAFE-${runId}`,
    title: "Tawny UI unsafe source_url fixture case",
    sourceSystem: "tawny",
    sourceReference: `tawny-ui-unsafe-${runId}`,
    sourceUrl: "javascript:alert(1)",
  });

  const caseIds = [caseId, unsafeCaseId];

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByLabel("Email").fill("admin@acme.local");
    await page.getByLabel("Password").fill("kelpieadmin");
    // `{ exact: true }` disambiguates from the "Sign in with passkey" button
    // that now also matches a loose "Sign in" name on this page.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");

    // ── 1. Case detail provenance ───────────────────────────────────────
    await page.goto(`${baseUrl}/cases/${caseId}`);
    await page.getByText("Imported from Tawny").waitFor();
    const detailText = await page.locator("body").innerText();
    assert.match(detailText, /Imported from Tawny/);
    assert.ok(
      detailText.includes(sourceReference),
      "case detail page must render the sourceReference value",
    );
    assert.ok(
      !detailText.includes("Microsoft Sentinel"),
      "a Tawny-sourced case must never be mislabelled as Microsoft Sentinel",
    );
    const sourceLink = page.getByRole("link", { name: "View source incident" });
    await sourceLink.waitFor();
    assert.equal(await sourceLink.getAttribute("href"), sourceUrl);
    const rel = await sourceLink.getAttribute("rel");
    assert.ok(rel?.includes("noopener"), "source incident link must set rel=noopener");
    assert.ok(rel?.includes("noreferrer"), "source incident link must set rel=noreferrer");

    // ── 2. Unsafe source_url is not rendered as a link ──────────────────
    await page.goto(`${baseUrl}/cases/${unsafeCaseId}`);
    await page.getByText("Imported from Tawny").waitFor();
    const unsafeHrefs = await page.locator("a[href]").evaluateAll((anchors) =>
      anchors.map((a) => a.getAttribute("href")),
    );
    assert.ok(
      !unsafeHrefs.some((href) => href?.startsWith("javascript:")),
      "no anchor on the case page may have a javascript: href, even for a bypassed row",
    );

    // ── 3. Queue source filter ──────────────────────────────────────────
    await page.goto(`${baseUrl}/cases?source=tawny`);
    await page.getByText(caseNumber, { exact: true }).waitFor();
    assert.equal(await page.locator('select[name="source"]').inputValue(), "tawny");

    await page.goto(`${baseUrl}/cases?source=microsoft_sentinel`);
    const filteredText = await page.locator("body").innerText();
    assert.ok(
      !filteredText.includes(caseNumber),
      "the Tawny fixture case must not appear when filtering by source=microsoft_sentinel",
    );

    // ── 4. Integrations card ────────────────────────────────────────────
    await page.goto(`${baseUrl}/settings/integrations`);
    await page
      .locator('a[href="/cases?source=tawny"]')
      .first()
      .waitFor();
    const integrationsText = await page.locator("body").innerText();
    assert.ok(integrationsText.includes("Tawny"), "integrations page must mention Tawny");
    assert.ok(
      integrationsText.includes("cases:write"),
      "integrations page must mention the cases:write scope",
    );
    assert.ok(
      integrationsText.includes("/api/v1/cases"),
      "integrations page must mention the /api/v1/cases endpoint",
    );
    const tokenLeak = /klp_[A-Za-z0-9_-]{20,}/.exec(integrationsText);
    assert.equal(
      tokenLeak,
      null,
      `integrations page must never render a real API token value, found: ${tokenLeak?.[0]}`,
    );

    console.log("Tawny UI provenance, unsafe-url rendering, queue filter, and integrations card passed.");
  } finally {
    await browser.close();
    await db.delete(timelineEvents).where(inArray(timelineEvents.caseId, caseIds));
    await db.delete(cases).where(inArray(cases.id, caseIds));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
