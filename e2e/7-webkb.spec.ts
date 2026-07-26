import { test, expect } from "@playwright/test";

/**
 * Linked knowledge bases, end to end against a real multi-page wiki fixture:
 * the shallow crawl discovers subpages and respects robots.txt; a page behind
 * sign-in fails with the reason and a way out; adding a site credential in
 * Settings makes the same link work.
 */
test.use({ storageState: "e2e/.artifacts/examiner.json" });

const WIKI = "http://127.0.0.1:4646";

async function ridePipelineToReady(page: import("@playwright/test").Page) {
  await page.waitForURL(/\/courses\//, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "A few questions" }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(
    page.getByRole("heading", { name: "Review the plan before building" }),
  ).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: /Build the modules/ }).click();
  await expect(page.getByRole("heading", { name: "The route" })).toBeVisible({
    timeout: 90_000,
  });
}

test("crawl discovers subpages and respects robots.txt", async ({ page }) => {
  await page.goto("/crea");
  await page.locator("#prompt").fill("Onboard from the wiki. One week.");
  await page.locator("#urls").fill(`${WIKI}/wiki/index.html`);
  await page
    .getByRole("checkbox", { name: /Include subpages/ })
    .check();
  await page.getByRole("button", { name: /Rig the path/ }).click();
  await ridePipelineToReady(page);

  // Every page was read, so the material panel stays collapsed: open it.
  await page.locator("summary").filter({ hasText: "Material" }).click();
  // Seed + the two linked subpages, each a real sized source.
  await expect(page.getByText("/wiki/index.html")).toBeVisible();
  await expect(page.getByText("/wiki/gateway.html")).toBeVisible();
  await expect(page.getByText("/wiki/failover.html")).toBeVisible();
  // The robots-disallowed page was never ingested.
  await expect(page.getByText("hidden/internal")).toHaveCount(0);
  // Off-site and asset links were never followed.
  await expect(page.getByText("elsewhere.example")).toHaveCount(0);
  await expect(page.getByText("logo.png")).toHaveCount(0);
});

test("a sign-in wall fails with the reason and a way out", async ({ page }) => {
  await page.goto("/crea");
  await page.locator("#prompt").fill("Onboard from the private handbook. One week.");
  await page.locator("#urls").fill(`${WIKI}/private/handbook.html`);
  await page.getByRole("button", { name: /Rig the path/ }).click();
  await ridePipelineToReady(page);

  const failed = page.locator("li", { hasText: "/private/handbook.html" }).first();
  await expect(failed).toBeVisible();
  await expect(failed.getByText(/requires sign-in/)).toBeVisible();
  await expect(
    failed.getByRole("link", { name: "Add site credentials" }),
  ).toBeVisible();
});

test("with a stored site token, the same link works", async ({ page }) => {
  // Store the credential through the Settings UI.
  await page.goto("/settings");
  await page.locator("#connections").scrollIntoViewIfNeeded();
  await page.getByPlaceholder("wiki.yourcompany.com").fill("127.0.0.1");
  await page
    .getByRole("textbox", { name: "Token", exact: true })
    .fill("wiki-secret-token");
  await page.getByRole("button", { name: "Add connection" }).click();
  await expect(page.getByText("127.0.0.1", { exact: true })).toBeVisible();

  // The same protected link now ingests.
  await page.goto("/crea");
  await page.locator("#prompt").fill("Onboard from the handbook, signed in. One week.");
  await page.locator("#urls").fill(`${WIKI}/private/handbook.html`);
  await page.getByRole("button", { name: /Rig the path/ }).click();
  await ridePipelineToReady(page);

  // All sources read fine, so the material panel stays collapsed: open it.
  await page.locator("summary").filter({ hasText: "Material" }).click();
  const src = page.locator("li", { hasText: "/private/handbook.html" }).first();
  await expect(src).toBeVisible();
  await expect(src.getByText(/KB$/)).toBeVisible();
  await expect(src.getByText(/requires sign-in/)).toHaveCount(0);
});
