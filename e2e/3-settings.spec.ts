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

  // Live connection test against the mock endpoint.
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/responded/)).toBeVisible();

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
