import assert from "node:assert/strict";
import { chromium, type BrowserContext, type Page } from "playwright";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { casePresence, cases, organisations, users } from "../src/db/schema";
import { CaseVersionConflictError, patchCaseCore } from "../src/lib/cases-core";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function signIn(context: BrowserContext, email: string, password: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  return page;
}

async function waitForDisabled(page: Page, selector: string, disabled: boolean) {
  await page.waitForFunction(
    ({ target, expected }) =>
      document.querySelector(target)?.matches(":disabled") === expected,
    { target: selector, expected: disabled },
    { timeout: 5_000 },
  );
}

async function loadCase() {
  const [organisation] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "acme-soc"))
    .limit(1);
  assert.ok(organisation, "seed the test database first");
  const [record] = await db
    .select()
    .from(cases)
    .where(eq(cases.organisationId, organisation.id))
    .limit(1);
  const team = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.organisationId, organisation.id));
  const admin = team.find((user) => user.email === "admin@acme.local");
  const analyst = team.find((user) => user.email === "analyst@acme.local");
  assert.ok(record && admin && analyst, "seeded case and users required");
  return { organisation, record, admin, analyst };
}

async function main() {
  const { organisation, record, admin, analyst } = await loadCase();
  const original = {
    summary: record.summary,
    severity: record.severity,
    classification: record.classification,
    version: record.version,
  };
  await db.delete(casePresence).where(eq(casePresence.caseId, record.id));

  const concurrent = await Promise.allSettled([
    patchCaseCore(
      organisation.id,
      admin.id,
      record.id,
      { severity: record.severity === "critical" ? "low" : "critical" },
      record.version,
    ),
    patchCaseCore(
      organisation.id,
      analyst.id,
      record.id,
      { classification: record.classification === "phishing" ? "malware" : "phishing" },
      record.version,
    ),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = concurrent.find((result) => result.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" && rejected.reason instanceof CaseVersionConflictError,
    "the losing concurrent save must return a version conflict",
  );

  const browser = await chromium.launch({ headless: true });
  const adminContext = await browser.newContext();
  const analystContext = await browser.newContext();
  try {
    const adminPage = await signIn(adminContext, "admin@acme.local", "kelpieadmin");
    const analystPage = await signIn(analystContext, "analyst@acme.local", "kelpieanalyst");
    await Promise.all([
      adminPage.goto(`${baseUrl}/cases/${record.id}`),
      analystPage.goto(`${baseUrl}/cases/${record.id}`),
    ]);
    await adminPage.waitForTimeout(1_000);

    await adminPage.getByRole("button", { name: "Edit summary" }).click();
    const analystSummaryButton = analystPage.getByRole("button", { name: "Edit summary" });
    const lockText = `${admin.name} is editing this field`;
    await analystPage.getByText(lockText).waitFor({ timeout: 5_000 });
    await waitForDisabled(analystPage, 'button[aria-label="Edit summary"]', true);

    await adminPage.locator("#case-summary").fill("Administrator draft");
    const [beforeExternal] = await db
      .select({ version: cases.version })
      .from(cases)
      .where(eq(cases.id, record.id));
    await patchCaseCore(
      organisation.id,
      analyst.id,
      record.id,
      { summary: "Analyst saved value" },
      beforeExternal.version,
    );
    await adminPage.getByRole("button", { name: "Save summary" }).click();
    await adminPage.getByRole("button", { name: "Keep theirs" }).waitFor();
    assert.equal(await adminPage.getByRole("button", { name: "Keep mine" }).count(), 1);
    assert.equal(await adminPage.getByRole("button", { name: "Merge", exact: true }).count(), 1);
    await adminPage.getByRole("button", { name: "Merge", exact: true }).click();
    await adminPage.getByLabel("Merged summary").fill("Merged analyst and administrator value");
    await adminPage.getByRole("button", { name: "Save merged summary" }).click();
    await adminPage.getByRole("button", { name: "Edit summary" }).waitFor();
    const [merged] = await db
      .select({ summary: cases.summary })
      .from(cases)
      .where(eq(cases.id, record.id));
    assert.equal(merged.summary, "Merged analyst and administrator value");

    await adminPage.locator("#case-severity").focus();
    await analystPage.getByText(lockText).waitFor({ timeout: 5_000 });
    await waitForDisabled(analystPage, "#case-severity", true);
    await adminPage.locator("#case-severity").blur();

    await Promise.all([
      adminPage.goto(`${baseUrl}/cases/${record.id}/tasks`),
      analystPage.goto(`${baseUrl}/cases/${record.id}/tasks`),
    ]);
    await adminPage.waitForTimeout(1_500);
    await adminPage.locator("#task-title").click();
    await analystPage.getByText(lockText).waitFor({ timeout: 5_000 });
    await waitForDisabled(analystPage, "#task-title", true);

    await adminPage.close();
    await analystPage.getByText(lockText).waitFor({ state: "detached", timeout: 8_000 });
    await waitForDisabled(analystPage, "#task-title", false);

    console.log("Atomic version conflicts, merge recovery, live field locks, and tab cleanup passed.");
  } finally {
    await browser.close();
    await db
      .update(cases)
      .set({
        summary: original.summary,
        severity: original.severity,
        classification: original.classification,
        version: original.version,
      })
      .where(and(eq(cases.id, record.id), eq(cases.organisationId, organisation.id)));
    await db.delete(casePresence).where(eq(casePresence.caseId, record.id));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
