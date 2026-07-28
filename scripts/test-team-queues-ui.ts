/**
 * UI smoke test for issue #54 (team queues/watchers/hand-offs/escalation/
 * workload). Exercises the cases list's operational-view chips, queue
 * column, and bulk-selection bar; the case detail "Queue & watchers" tab;
 * the workload dashboard; and the teams/escalation-policies settings pages.
 *
 * Assumes a server is already listening at APP_URL (default
 * http://127.0.0.1:3000) against a seeded database (`npm run db:seed`).
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { cases, organisations, users } from "../src/db/schema";
import { newId } from "../src/lib/utils";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function main() {
  const [organisation] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "acme-soc"))
    .limit(1);
  assert.ok(organisation, "seed the test database first (npm run db:seed)");
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin@acme.local"))
    .limit(1);
  assert.ok(admin, "seed the test database first (npm run db:seed)");

  const caseId = newId("case");
  await db.insert(cases).values({
    id: caseId,
    organisationId: organisation.id,
    caseNumber: `QUEUE-UI-${Date.now()}`,
    title: "Queue UI smoke test case",
    severity: "high",
  });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByLabel("Email").fill("admin@acme.local");
    await page.getByLabel("Password").fill("kelpieadmin");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/dashboard");

    // Cases list: operational-view chips, queue column, bulk selection bar.
    await page.goto(`${baseUrl}/cases`);
    await page.getByRole("link", { name: "Unassigned" }).waitFor();
    await page.getByRole("link", { name: "My cases" }).waitFor();
    await page.getByRole("link", { name: "Watched cases" }).waitFor();
    await page.getByRole("link", { name: "SLA warning/breached" }).waitFor();
    await page.getByRole("link", { name: "Awaiting third party" }).waitFor();
    await page.getByRole("link", { name: "Awaiting approval" }).waitFor();
    await page.getByRole("link", { name: "Stale investigation" }).waitFor();
    await page.getByRole("link", { name: "Recently reopened" }).waitFor();
    await page.getByRole("columnheader", { name: "Queue" }).waitFor();
    console.log("ok: operational-view chips and queue column render on /cases");

    const rowCheckbox = page.getByRole("checkbox", { name: /Select case QUEUE-UI-/ });
    await rowCheckbox.waitFor();
    await rowCheckbox.check();
    await page.getByRole("region", { name: "Bulk case actions" }).waitFor();
    await page.getByText("1 case selected").waitFor();
    console.log("ok: selecting a case row reveals the bulk action bar");

    // Case detail: Queue & watchers tab.
    await page.goto(`${baseUrl}/cases/${caseId}/queue`);
    await page.getByRole("heading", { name: "Queue", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Watchers", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Shift hand-off", exact: true }).waitFor();
    await page.getByLabel("Team queue").waitFor();
    await page.getByRole("button", { name: "Acknowledge case" }).waitFor();
    console.log("ok: case detail Queue & watchers tab renders its sections");

    // Workload dashboard.
    await page.goto(`${baseUrl}/workload`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.locator("table").first().waitFor();
    console.log("ok: /workload dashboard renders");

    // Settings: teams and escalation policies.
    await page.goto(`${baseUrl}/settings/teams`);
    await page.getByLabel(/name/i).first().waitFor();
    console.log("ok: /settings/teams renders a create-team form");

    await page.goto(`${baseUrl}/settings/escalation-policies`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    console.log("ok: /settings/escalation-policies renders");
  } finally {
    await browser.close();
    await db.delete(cases).where(eq(cases.id, caseId));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
