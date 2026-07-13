import assert from "node:assert/strict";
import { chromium } from "playwright";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { cases, organisations } from "../src/db/schema";
import { newId } from "../src/lib/utils";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function main() {
  const [organisation] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "acme-soc"))
    .limit(1);
  assert.ok(organisation, "seed the test database first");

  const ids: string[] = [];
  const values: Array<typeof cases.$inferInsert> = [];
  for (let index = 1; index <= 55; index++) {
    const id = newId("case");
    ids.push(id);
    values.push({
      id,
      organisationId: organisation.id,
      caseNumber: `QUEUE-TEST-${String(index).padStart(4, "0")}`,
      title: index === 17 ? "Queue needle investigation" : `Queue pagination case ${index}`,
      severity: index === 1 ? "critical" : "medium",
      openedAt:
        index === 1
          ? new Date(Date.now() - 2 * 60 * 60 * 1000)
          : new Date(Date.now() - index * 60_000),
      tags: index === 23 ? ["queue-tag"] : [],
    });
  }
  await db.insert(cases).values(values);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByLabel("Email").fill("admin@acme.local");
    await page.getByLabel("Password").fill("kelpieadmin");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.goto(`${baseUrl}/cases?q=Queue%20needle`);
    await page.getByRole("link", { name: "Queue needle investigation" }).waitFor();
    assert.match(await page.locator("body").innerText(), /Showing 1-1 of 1 matching case/);

    await page.goto(`${baseUrl}/cases?sort=recent`);
    assert.match(await page.locator("body").innerText(), /Showing 1-50 of 56 matching cases/);
    await page.getByRole("link", { name: "Next" }).click();
    await page.getByText("Showing 51-56 of 56 matching cases").waitFor();
    assert.match(await page.locator("body").innerText(), /Showing 51-56 of 56 matching cases/);

    await page.goto(`${baseUrl}/cases?sla=risk`);
    await page.getByText("QUEUE-TEST-0001", { exact: true }).waitFor();
    assert.match(await page.locator("body").innerText(), /at risk/i);

    await page.goto(`${baseUrl}/cases?tag=queue-tag`);
    await page.getByText("QUEUE-TEST-0023", { exact: true }).waitFor();

    await page.goto(`${baseUrl}/cases?status=invalid&page=abc&sort=unknown`);
    assert.equal(await page.locator('select[name="sort"]').inputValue(), "priority");
    assert.match(await page.locator("body").innerText(), /Showing 1-50 of 56 matching cases/);

    for (const name of [
      "status",
      "severity",
      "classification",
      "tlp",
      "assignee",
      "sla",
      "sort",
    ]) {
      assert.equal(await page.locator(`select[name="${name}"]`).count(), 1);
    }
    console.log("Case queue search, filters, SLA risk, and pagination passed.");
  } finally {
    await browser.close();
    await db.delete(cases).where(inArray(cases.id, ids));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
