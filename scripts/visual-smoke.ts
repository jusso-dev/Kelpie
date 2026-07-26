import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseUrl = process.env.APP_URL ?? "http://127.0.0.1:3000";
const outputDir = process.env.VISUAL_OUTPUT_DIR ?? "/tmp/kelpie-visual-smoke";

async function main() {
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch();
  try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/sign-in`);
  await page.getByLabel("Email").fill("admin@acme.local");
  await page.getByLabel("Password").fill("kelpieadmin");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");

  for (const route of ["/settings", "/cases/new", "/settings/integrations"]) {
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");
    const name = route.slice(1).replaceAll("/", "-");
    await page.screenshot({
      path: `${outputDir}/${name}-desktop.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `${route} overflows desktop viewport`,
    );
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/settings", "/cases/new", "/settings/integrations"]) {
    await page.goto(`${baseUrl}${route}`);
    await page.waitForLoadState("networkidle");
    const name = route.slice(1).replaceAll("/", "-");
    await page.screenshot({
      path: `${outputDir}/${name}-mobile.png`,
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `${route} overflows mobile viewport`,
    );
  }
  console.log(`visual smoke passed; screenshots: ${outputDir}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
