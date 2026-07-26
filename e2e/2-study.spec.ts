import { test, expect, request as pwRequest } from "@playwright/test";
import { STUDENT } from "./personas";

/**
 * The student side, on the seeded demo course: enrollment, reading, the
 * resume bookmark, answering anchors (confidence before reveal), the honest
 * dashboard, and the examiner's roster view.
 */

const COURSE = "course_demo_acme";

test.describe("student journey", () => {
  test.use({ storageState: "e2e/.artifacts/student.json" });

  test.beforeAll(async ({}, testInfo) => {
    // The examiner enrolls the student (their own flow, via API).
    const ctx = await pwRequest.newContext({
      baseURL: testInfo.project.use.baseURL as string,
      storageState: "e2e/.artifacts/examiner.json",
    });
    const res = await ctx.post(`/api/courses/${COURSE}/enroll`, {
      data: { email: STUDENT.email },
    });
    if (res.status() !== 201) {
      throw new Error(`enroll failed: ${res.status()} ${await res.text()}`);
    }
    await ctx.dispose();
  });

  test("student reads a module and gets a resume bookmark", async ({ page }) => {
    await page.goto(`/courses/${COURSE}`);
    await expect(page.getByRole("heading", { name: "The route" })).toBeVisible();

    // Open the first module; the position beacon records it.
    const beacon = page.waitForResponse(
      (r) => r.url().includes("/position") && r.status() === 200,
    );
    await page.locator("ol li a").first().click();
    await expect(page.getByText(/Module 0?0/)).toBeVisible();
    await beacon;

    // Back on the overview, the carabiner bookmark offers to resume.
    await page.goto(`/courses/${COURSE}`);
    await expect(page.getByText("Resume where you left off")).toBeVisible();
  });

  test("student answers an anchor: confidence before reveal", async ({
    page,
  }) => {
    await page.goto(`/courses/${COURSE}`);
    await page.getByText("Resume where you left off").click();

    const anchors = page.getByLabel("Anchors");
    await expect(anchors).toBeVisible();

    // The answer stays hidden until a confidence is chosen.
    const first = anchors.locator("li").first();
    await expect(first.getByRole("button", { name: "Show the answer" })).toBeDisabled();
    await first.getByRole("button", { name: "Sure" }).first().click();
    await first.getByRole("button", { name: "Show the answer" }).click();
    await first.getByRole("button", { name: "I had it" }).click();
    await expect(first.getByText("Recorded.")).toBeVisible();
  });

  test("dashboard shows honest readiness, not a completion bar", async ({
    page,
  }) => {
    await page.goto(`/courses/${COURSE}/dashboard`);
    await expect(
      page.getByRole("heading", { name: "What you actually know" }),
    ).toBeVisible();
    await expect(page.getByText(/questions attempted/)).toBeVisible();
  });

  test("explain-back verdict lands on the dashboard", async ({ page }) => {
    await page.goto(`/courses/${COURSE}`);
    await page.getByText("Resume where you left off").click();

    const panel = page.getByLabel("Feynman");
    await panel.scrollIntoViewIfNeeded();
    await panel
      .getByRole("textbox")
      .fill(
        "The gateway routes requests to healthy backends and fails over via a shared address.",
      );
    await panel.getByRole("button", { name: /Where am I wrong\?/ }).click();
    // Mock coach verdict: a gap on what empties the pool.
    await expect(panel.getByText("What empties the pool.")).toBeVisible();

    await page.goto(`/courses/${COURSE}/dashboard`);
    await expect(page.getByText("explained, with a gap").first()).toBeVisible();
  });
});

test.describe("examiner view", () => {
  test.use({ storageState: "e2e/.artifacts/examiner.json" });

  test("roster shows a student enrolled in the examiner's own course", async ({
    page,
  }) => {
    // The examiner page lists only courses they own; the journey spec created
    // one. Enroll the student there, then the roster shows them.
    await page.goto("/examiner");
    const link = page.getByRole("link", { name: /Acme edge onboarding/ }).first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    const courseId = href?.split("/").pop() ?? "";
    const res = await page.request.post(`/api/courses/${courseId}/enroll`, {
      data: { email: STUDENT.email },
    });
    if (res.status() !== 201) {
      throw new Error(`enroll failed: ${res.status()} ${await res.text()}`);
    }
    await page.reload();
    await expect(page.getByText(STUDENT.email).first()).toBeVisible();
  });
});
