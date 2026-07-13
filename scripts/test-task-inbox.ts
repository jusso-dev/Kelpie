import assert from "node:assert/strict";
import { chromium } from "playwright";
import { eq, inArray } from "drizzle-orm";
import { db } from "../src/db";
import { cases, caseTasks, organisations, users } from "../src/db/schema";
import { newId } from "../src/lib/utils";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function main() {
  const [organisation] = await db
    .select({ id: organisations.id })
    .from(organisations)
    .where(eq(organisations.slug, "acme-soc"))
    .limit(1);
  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "admin@acme.local"))
    .limit(1);
  const [analyst] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, "analyst@acme.local"))
    .limit(1);
  assert.ok(organisation && admin && analyst, "seed the test database first");

  const caseIds = [newId("case"), newId("case")];
  await db.insert(cases).values([
    {
      id: caseIds[0],
      organisationId: organisation.id,
      caseNumber: "TASK-INBOX-0001",
      title: "Task inbox primary case",
      severity: "critical",
    },
    {
      id: caseIds[1],
      organisationId: organisation.id,
      caseNumber: "TASK-INBOX-0002",
      title: "Task inbox secondary case",
      severity: "medium",
    },
  ]);

  const now = Date.now();
  const taskIds = Array.from({ length: 6 }, () => newId("task"));
  await db.insert(caseTasks).values([
    {
      id: taskIds[0],
      caseId: caseIds[0],
      title: "Inbox overdue task",
      assigneeId: admin.id,
      dueAt: new Date(now - 2 * 60 * 60 * 1000),
      orderIndex: 1,
    },
    {
      id: taskIds[1],
      caseId: caseIds[0],
      title: "Inbox soon task",
      assigneeId: admin.id,
      dueAt: new Date(now + 2 * 60 * 60 * 1000),
      orderIndex: 2,
    },
    {
      id: taskIds[2],
      caseId: caseIds[1],
      title: "Inbox later task",
      dueAt: new Date(now + 3 * 24 * 60 * 60 * 1000),
      orderIndex: 1,
    },
    {
      id: taskIds[3],
      caseId: caseIds[1],
      title: "Inbox no date task",
      status: "blocked",
      orderIndex: 2,
    },
    {
      id: taskIds[4],
      caseId: caseIds[1],
      title: "Inbox completed task",
      status: "done",
      completedAt: new Date(now - 60_000),
      completedBy: admin.id,
      orderIndex: 3,
    },
    {
      id: taskIds[5],
      caseId: caseIds[0],
      title: "Inbox update target",
      assigneeId: admin.id,
      orderIndex: 3,
    },
  ]);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByLabel("Email").fill("admin@acme.local");
    await page.getByLabel("Password").fill("kelpieadmin");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    await page.getByRole("link", { name: "Tasks", exact: true }).click();
    await page.waitForURL("**/tasks");
    const body = await page.locator("body").innerText();
    assert.doesNotMatch(body, /Inbox completed task/);
    assert.ok(body.indexOf("Inbox overdue task") < body.indexOf("Inbox soon task"));
    assert.ok(body.indexOf("Inbox soon task") < body.indexOf("Inbox later task"));
    assert.ok(body.indexOf("Inbox later task") < body.indexOf("Inbox no date task"));

    await page.goto(`${baseUrl}/tasks?assignee=mine`);
    await page.getByText("Inbox overdue task", { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /Inbox later task/);

    await page.goto(`${baseUrl}/tasks?due=overdue`);
    await page.getByText("Inbox overdue task", { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /Inbox soon task/);

    await page.goto(`${baseUrl}/tasks?status=done`);
    await page.getByText("Inbox completed task", { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /Inbox overdue task/);

    await page.goto(`${baseUrl}/tasks?status=invalid&due=unknown&assignee=missing&page=abc`);
    assert.equal(await page.locator('select[name="status"]').inputValue(), "open");
    assert.equal(await page.locator('select[name="due"]').inputValue(), "any");
    assert.equal(await page.locator('select[name="assignee"]').inputValue(), "");

    const updateCard = page.locator("article", { hasText: "Inbox update target" });
    await updateCard.getByLabel("Status for task Inbox update target").selectOption("done");
    await updateCard.waitFor({ state: "detached" });
    const [updated] = await db
      .select({ status: caseTasks.status, completedBy: caseTasks.completedBy })
      .from(caseTasks)
      .where(eq(caseTasks.id, taskIds[5]))
      .limit(1);
    assert.deepEqual(updated, { status: "done", completedBy: admin.id });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${baseUrl}/tasks?due=soon`);
    await page.getByText("Inbox soon task", { exact: true }).waitFor();
    assert.equal(await page.locator("body").evaluate((element) => element.scrollWidth <= window.innerWidth), true);

    await db.update(users).set({ role: "read_only" }).where(eq(users.id, analyst.id));
    const readOnlyPage = await browser.newPage();
    await readOnlyPage.goto(`${baseUrl}/sign-in`);
    await readOnlyPage.getByLabel("Email").fill("analyst@acme.local");
    await readOnlyPage.getByLabel("Password").fill("kelpieanalyst");
    await readOnlyPage.getByRole("button", { name: "Sign in" }).click();
    await readOnlyPage.waitForURL("**/dashboard");
    await readOnlyPage.goto(`${baseUrl}/tasks?due=soon`);
    const readOnlyStatus = readOnlyPage.getByLabel("Status for task Inbox soon task");
    await readOnlyStatus.waitFor();
    assert.equal(await readOnlyStatus.isDisabled(), true);

    console.log("Task inbox priority, filters, role enforcement, inline updates, navigation, and narrow layout passed.");
  } finally {
    await browser.close();
    await db.update(users).set({ role: "analyst" }).where(eq(users.id, analyst.id));
    await db.delete(cases).where(inArray(cases.id, caseIds));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
