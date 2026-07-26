import { test, expect } from "@playwright/test";

/** Gates and edge states: auth redirects, role walls, 404s. */

test("anonymous visitors are sent to login", async ({ page }) => {
  await page.goto("/courses");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("unknown routes fall off the map", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.artifacts/examiner.json",
  });
  const page = await ctx.newPage();
  await page.goto("/definitely/not/a/route");
  await expect(page.getByText("Off the route")).toBeVisible();
  await ctx.close();
});

test("unknown course id is a 404, not a crash", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.artifacts/examiner.json",
  });
  const page = await ctx.newPage();
  await page.goto("/courses/course_does_not_exist");
  await expect(page.getByText("Off the route")).toBeVisible();
  await ctx.close();
});

test("students cannot use examiner APIs", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.artifacts/student.json",
  });
  const enroll = await ctx.request.post(
    "/api/courses/course_demo_acme/enroll",
    { data: { email: "nobody@e2e.test" } },
  );
  expect(enroll.status()).toBe(403);
  const settings = await ctx.request.post("/api/settings/llm", {
    data: { values: { ANTHROPIC_API_KEY: "sk-should-not-work" } },
  });
  expect(settings.status()).toBe(403);
  await ctx.close();
});

test("the maintenance page renders standalone", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: "e2e/.artifacts/examiner.json",
  });
  const page = await ctx.newPage();
  await page.goto("/maintenance");
  await expect(page.getByText("We’ll be right back")).toBeVisible();
  await expect(page.getByText(/rappelling down/)).toBeVisible();
  await ctx.close();
});
