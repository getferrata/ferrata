import { test, expect } from "@playwright/test";

/**
 * Material ingestion and course output paths: an uploaded file becomes a
 * grounded source, an unreachable link fails honestly instead of silently,
 * the finished course exports as a portable package, and review renders.
 */
test.use({ storageState: "e2e/.artifacts/examiner.json" });

const RUNBOOK = [
  "# Edge gateway runbook",
  "",
  "The edge gateway terminates TLS and routes by path prefix.",
  "A 503 at the edge means the upstream pool is empty: check the service",
  "registry before touching the gateway. Failover is automatic via VRRP.",
].join("\n");

test("file upload becomes a source; a dead link fails honestly", async ({
  page,
}) => {
  await page.goto("/crea");
  await page
    .locator("#prompt")
    .fill("Onboard on the runbook material. One week.");

  // Attach a real file and a link the server can never fetch (SSRF guard
  // rejects private addresses by design).
  await page.locator("#files").setInputFiles({
    name: "runbook.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(RUNBOOK),
  });
  await page.locator("#urls").fill("http://127.0.0.1:9/private-wiki");

  await page.getByRole("button", { name: /Rig the path/ }).click();
  await page.waitForURL(/\/courses\//, { timeout: 30_000 });

  // Ride the pipeline to ready (mock model).
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

  // The uploaded file is a real, sized source; the dead link is "not read".
  await expect(page.getByText("runbook.md")).toBeVisible();
  const dead = page
    .locator("li", { hasText: "127.0.0.1:9/private-wiki" })
    .first();
  await expect(dead).toBeVisible();
  await expect(dead.getByText("not read")).toBeVisible();
});

test("a finished course exports as a portable package", async ({ page }) => {
  await page.goto("/courses");
  await page.getByRole("link", { name: /Acme edge onboarding/ }).first().click();
  await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();

  const downloadP = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export Ferrata package" }).click();
  const download = await downloadP;
  expect(download.suggestedFilename()).toMatch(/\.ferrata\.json$/);
});

test("review renders honestly for the student", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.artifacts/student.json",
  });
  const page = await ctx.newPage();
  await page.goto("/courses/course_demo_acme/review");
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  // Either a due session or the honest empty state; never a crash.
  await expect(
    page.getByText(/Nothing due right now|How sure are you|Show the answer/).first(),
  ).toBeVisible();
  await ctx.close();
});

test("material alone is enough: no brief required", async ({ page }) => {
  await page.goto("/crea");
  // No brief at all; just a file.
  await page.locator("#files").setInputFiles({
    name: "notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(RUNBOOK),
  });
  await page.getByRole("button", { name: /Rig the path/ }).click();
  await page.waitForURL(/\/courses\//, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "A few questions" }),
  ).toBeVisible({ timeout: 60_000 });
});

test("nothing at all is refused with a clear message", async ({ page }) => {
  await page.goto("/crea");
  await page.getByRole("button", { name: /Rig the path/ }).click();
  await expect(
    page.getByText("Write a brief or attach at least one piece of material", {
      exact: false,
    }),
  ).toBeVisible();
});
