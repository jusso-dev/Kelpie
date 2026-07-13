import assert from "node:assert/strict";
import { chromium } from "playwright";
import { sql } from "drizzle-orm";
import { db } from "../src/db";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";

async function hasVisibleFocus(page: import("playwright").Page): Promise<boolean> {
  return page.locator(":focus-visible").evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  let tasksRenamed = false;
  let usersRenamed = false;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(`${baseUrl}/sign-in`);
    await page.getByLabel("Email").fill("admin@acme.local");
    await page.getByLabel("Password").fill("kelpieadmin");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");

    const missingRecords = [
      ["/cases/missing-case", "Case not found", "Return to case queue"],
      ["/alerts/missing-alert", "Alert not found", "Return to alert queue"],
      ["/playbooks/missing-playbook", "Playbook not found", "Return to playbooks"],
    ] as const;
    for (const [path, heading, recoveryLink] of missingRecords) {
      await page.goto(`${baseUrl}${path}`);
      await page.getByRole("heading", { name: heading }).waitFor();
      assert.equal(await page.getByRole("link", { name: recoveryLink }).count(), 1);
      assert.match(await page.locator("body").innerText(), /No .* data was changed|Existing case tasks were not affected/);
    }

    await page.goto(`${baseUrl}/cases/missing-case`);
    await page.keyboard.press("Tab");
    assert.equal(await hasVisibleFocus(page), true);

    const attachmentResponse = await page.request.get(`${baseUrl}/api/attachments/missing-attachment`);
    assert.equal(attachmentResponse.status(), 404);
    assert.deepEqual(await attachmentResponse.json(), { error: "Attachment not found" });

    await db.execute(sql.raw("alter table case_tasks rename to case_tasks_recovery_test"));
    tasksRenamed = true;
    await page.goto(`${baseUrl}/tasks`);
    await page.getByRole("heading", { name: "This view could not be loaded" }).waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /relation .* does not exist|select .* from/i);
    await db.execute(sql.raw("alter table case_tasks_recovery_test rename to case_tasks"));
    tasksRenamed = false;
    await page.getByRole("button", { name: "Retry this view" }).click();
    await page.getByRole("heading", { name: "Work that needs attention across every case" }).waitFor();

    await db.execute(sql.raw("alter table users rename to users_recovery_test"));
    usersRenamed = true;
    await page.goto(`${baseUrl}/dashboard`);
    await page.getByRole("heading", { name: "The application could not be loaded" }).waitFor();
    assert.doesNotMatch(await page.locator("body").innerText(), /relation .* does not exist|select .* from/i);
    await page.keyboard.press("Tab");
    assert.equal(await hasVisibleFocus(page), true);
    await db.execute(sql.raw("alter table users_recovery_test rename to users"));
    usersRenamed = false;

    const publicPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await publicPage.goto(`${baseUrl}/address-that-does-not-exist`);
    await publicPage.getByRole("heading", { name: "That address does not lead anywhere" }).waitFor();
    assert.equal(
      await publicPage.locator("body").evaluate((element) => element.scrollWidth <= window.innerWidth),
      true,
    );

    console.log("Recovery boundaries, record-specific 404s, safe copy, keyboard focus, and narrow layout passed.");
  } finally {
    if (tasksRenamed) {
      await db.execute(sql.raw("alter table case_tasks_recovery_test rename to case_tasks"));
    }
    if (usersRenamed) {
      await db.execute(sql.raw("alter table users_recovery_test rename to users"));
    }
    await browser.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
