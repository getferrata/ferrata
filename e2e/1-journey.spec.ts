import { test, expect } from "@playwright/test";

/**
 * The critical authoring journey, end to end on the real pipeline (jobs,
 * statuses, parsing) against the deterministic mock model: create a course
 * from a brief, answer the interview, review the plan, build, and read the
 * finished course with its tests.
 */
test.use({ storageState: "e2e/.artifacts/examiner.json" });

test("author creates a course from brief to ready", async ({ page }) => {
  await page.goto("/crea");
  await expect(
    page.getByRole("heading", { name: "Rig a path" }),
  ).toBeVisible();

  await page
    .locator("#prompt")
    .fill(
      "Onboard a new on-call engineer on the Acme edge gateway. Two weeks.",
    );
  await page.getByRole("button", { name: /Rig the path/ }).click();
  await page.waitForURL(/\/courses\//, { timeout: 30_000 });

  // Interview (mock produces two questions); answer one, continue.
  await expect(
    page.getByRole("heading", { name: "A few questions" }),
  ).toBeVisible({ timeout: 60_000 });
  await page
    .locator("textarea")
    .first()
    .fill("New on-call engineers joining the platform team.");
  await page.getByRole("button", { name: /Continue/ }).click();

  // Concept review (mock intake returns three concepts). Uncheck nothing.
  await expect(
    page.getByRole("heading", { name: "Review the plan before building" }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("The edge gateway").first()).toBeVisible();
  await expect(page.getByText("Reading a 503").first()).toBeVisible();

  // Cost estimate shows before committing (mock model is not in the price
  // table, so it reads as free).
  await expect(page.getByText(/Estimated cost/)).toBeVisible();

  await page.getByRole("button", { name: /Build the modules/ }).click();

  // The climb: cable progress with the reassurance line.
  await expect(
    page.getByText("You can close this page. Generation keeps running", {
      exact: false,
    }),
  ).toBeVisible({ timeout: 30_000 });

  // Ready: overview appears with the route and the generated modules.
  await expect(page.getByRole("heading", { name: "The route" })).toBeVisible({
    timeout: 90_000,
  });
  await expect(
    page.getByRole("heading", { name: "Acme edge onboarding" }),
  ).toBeVisible();

  // Open the first module: content and its anchors (tests) are there.
  await page.getByRole("link", { name: /The edge gateway/ }).first().click();
  await expect(page.getByText("The idea, in two lines")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Anchors" })).toBeVisible();
  await expect(
    page.getByText("A 503 at the edge: what is the first thing you check?"),
  ).toBeVisible();
});

test("finished course carries schedule and glossary", async ({ page }) => {
  await page.goto("/courses");
  await page.getByRole("link", { name: /Acme edge onboarding/ }).click();
  await expect(page.getByText("Study plan")).toBeVisible();
  await page.getByRole("link", { name: "quick glossary" }).click();
  await expect(page.getByText("Readiness probe", { exact: false })).toBeVisible();
});
