import { test, expect, request as pwRequest } from "@playwright/test";
import { EXAMINER } from "./personas";

/** The register and login screens themselves, through the browser. */

test("a stranger cannot sign themselves up", async ({ page }) => {
  // The whole point of the install being closed: no invite, no account, and
  // the refusal arrives before anyone types a password.
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: /invite only/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(
    0,
  );
});

test("an invited person registers, signs out and back in", async ({
  page,
  browser,
}, testInfo) => {
  const ctx = await pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/examiner.json",
  });
  const minted = await ctx.post("/api/invites", { data: { role: "examiner" } });
  expect(minted.status()).toBe(201);
  const { token } = (await minted.json()) as { token: string };
  await ctx.dispose();
  void browser;

  await page.goto(`/invito/${token}`);
  await expect(page.getByText(/works once/i)).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();

  await page.getByLabel(/Email/).fill("ui-user@e2e.test");
  await page.getByLabel(/Name/).fill("Ui User");
  await page.getByLabel(/Password/).fill("ui-user-pass-1");
  // No role picker: the invite decided that already.
  await expect(
    page.getByRole("button", { name: "Examiner / tutor" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Create account" }).click();

  await page.waitForURL(/\/(examiner|courses)/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/(login|$)/);

  // Wrong password: honest error, no session.
  await page.goto("/login");
  await page.getByLabel(/Email/).fill("ui-user@e2e.test");
  await page.getByLabel(/Password/).fill("wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  // Right password: in.
  await page.getByLabel(/Password/).fill("ui-user-pass-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(examiner|courses)/);
});

test("a used invite is refused, with the reason", async ({ page }, testInfo) => {
  const ctx = await pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/examiner.json",
  });
  const minted = await ctx.post("/api/invites", { data: { role: "student" } });
  const { token } = (await minted.json()) as { token: string };
  const first = await ctx.post("/api/auth/register", {
    data: {
      email: "burned@e2e.test",
      name: "Burned",
      password: "burned-pass-1",
      invite: token,
    },
  });
  expect(first.status()).toBe(201);
  await ctx.dispose();

  await page.goto(`/invito/${token}`);
  await expect(
    page.getByRole("heading", { name: /already used/i }),
  ).toBeVisible();
});

test("a student account cannot build a course", async ({}, testInfo) => {
  // The role gate that matters: building spends money on the install's key.
  const ctx = await pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/student.json",
  });
  const form = new URLSearchParams({ prompt: "onboard me on the edge gateway" });
  const res = await ctx.post("/api/courses", {
    multipart: { prompt: form.get("prompt") as string },
  });
  expect(res.status()).toBe(403);
  await ctx.dispose();
});

test("a student cannot import a course or export someone else's", async ({}, testInfo) => {
  // The edge gate only checks that a session cookie exists, so having any
  // account used to be enough to reach these. It is not any more.
  const asStudent = await pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/student.json",
  });
  expect((await asStudent.post("/api/import", { data: {} })).status()).toBe(403);
  expect(
    (await asStudent.post("/api/import/preview", { data: {} })).status(),
  ).toBe(403);
  expect(
    (await asStudent.post("/api/courses/course_demo_acme/export")).status(),
  ).toBe(403);
  await asStudent.dispose();
  void EXAMINER;
});

test("the sign-in page does not offer a door that is shut", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText(/come from an invite link/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Create one" })).toHaveCount(0);
});
