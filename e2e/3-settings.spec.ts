import { test, expect } from "@playwright/test";

/**
 * The model & key panel: live model list from the (mock) provider with human
 * names, saving applies immediately, the connection test makes a real call,
 * and Contextia is explained on the page.
 */
test.use({ storageState: "e2e/.artifacts/examiner.json" });

test("settings panel lists live models, tests, and saves", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Model & key" })).toBeVisible();

  // Contextia, in its own brand, with the explainer link.
  await expect(page.getByText("Contextia", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "How Contextia works" }),
  ).toHaveAttribute("href", "https://contextia.dev");

  // Choose the OpenAI-compatible provider; the env key already points at the
  // mock server, so the model list loads live with prettified names.
  await page
    .getByRole("combobox")
    .first()
    .selectOption({ label: "OpenAI and compatible (ChatGPT, gateways)" });
  const writing = page.getByLabel("Writing model (modules and tests)");
  await expect(writing.getByRole("option", { name: /Mock Strong/ })).toBeAttached({
    timeout: 15_000,
  });
  await writing.selectOption({ label: "Mock Strong" });

  // Live connection test against the mock endpoint. It says what it proved,
  // which is that the key works: it checks with a cheap model, not with the
  // writing model, and reading its result as "we are set to this model" is a
  // mistake the wording used to invite.
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/key works, checked with/)).toBeVisible();

  // Save applies without a restart: the active banner reflects the choice.
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved. New generations use this configuration.")).toBeVisible();
  await expect(page.getByText(/openai · mock-strong/)).toBeVisible();
});

test("students cannot reach settings", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.artifacts/student.json",
  });
  const page = await ctx.newPage();
  await page.goto("/settings");
  await expect(page.getByText("Off the route")).toBeVisible();
  const api = await ctx.request.get("/api/settings/llm");
  expect(api.status()).toBe(403);
  await ctx.close();
});

test("the preflight builds a real module and reports what it cost", async ({
  page,
}) => {
  // The connection test says the provider replied. This says the model got
  // through every stage, in the shapes the pipeline asks for, and says what
  // was billed for calls that were thrown away.
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Try the model" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Run a test module" }).click();

  await expect(page.getByText("This model works with Ferrata.")).toBeVisible({
    timeout: 60_000,
  });
  // Every stage of the pipeline is accounted for by name, not just a tick.
  for (const stage of [
    "Reading the brief",
    "Writing a module",
    "Making it concrete",
    "Judging it",
    "Writing its tests",
    "Planning the study",
    "Building the glossary",
  ]) {
    await expect(page.getByRole("cell", { name: stage })).toBeVisible();
  }
  await expect(page.getByText(/none discarded/)).toBeVisible();
});

test("students cannot spend the key on a preflight", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.artifacts/student.json",
  });
  const res = await ctx.request.post("/api/settings/preflight");
  expect(res.status()).toBe(403);
  await ctx.close();
});
