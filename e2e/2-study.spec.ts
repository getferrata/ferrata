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
    await expect(first.getByText("Right.")).toBeVisible();
  });

  test("a multiple choice is answered, and the server decides", async ({
    page,
  }) => {
    await page.goto(`/courses/${COURSE}`);
    await page.getByText("Resume where you left off").click();

    const anchors = page.getByLabel("Anchors");
    const mcq = anchors
      .locator("li")
      .filter({ hasText: "Which service terminates inbound TLS?" });
    await mcq.scrollIntoViewIfNeeded();

    // The options are shown, which is the whole point: they were being
    // generated and then hidden behind a self-graded reveal.
    await expect(mcq.getByRole("radio")).toHaveCount(3);

    // exact: "Sure" is a substring of "Fairly sure".
    await mcq.getByRole("button", { name: "Sure", exact: true }).click();
    await mcq.getByRole("radio", { name: "Postgres" }).check();
    await mcq.getByRole("button", { name: "Answer" }).click();

    // No "I had it" button: the student does not get to grade this one, and
    // the wrong choice they made with high confidence is what gets recorded.
    await expect(mcq.getByText(/Sure and wrong/)).toBeVisible();
    await expect(mcq.getByRole("button", { name: "I had it" })).toHaveCount(0);
  });

  test("a cloze with stored answers is typed, not self-graded", async ({
    page,
  }) => {
    await page.goto(`/courses/${COURSE}`);
    await page.getByText("Resume where you left off").click();

    const anchors = page.getByLabel("Anchors");
    const cloze = anchors
      .locator("li")
      .filter({ hasText: "the backend pool is" });
    await cloze.scrollIntoViewIfNeeded();

    await cloze.getByRole("button", { name: "Fairly sure" }).click();
    // Case and stray punctuation must not decide whether somebody knows this.
    await cloze.getByRole("textbox", { name: "Blank 1" }).fill("  EMPTY. ");
    await cloze.getByRole("button", { name: "Answer" }).click();
    await expect(cloze.getByText("Right.")).toBeVisible();
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

test.describe("an author fixing their own course", () => {
  test.use({ storageState: "e2e/.artifacts/examiner.json" });

  test("edits a module by hand, and the change is what students read", async ({
    page,
  }) => {
    await page.goto(`/courses/${COURSE}`);
    await page.getByRole("link", { name: /The edge gateway/ }).first().click();

    const marker = `Checked against the runbook on ${Date.now()}.`;
    await page.getByRole("button", { name: "Edit this module" }).click();
    const box = page.getByLabel("Module source (markdown)");
    await box.fill(`${await box.inputValue()}\n\n${marker}`);
    await page.getByRole("button", { name: "Save" }).click();

    // Back to the rendered article, through the normal pipeline.
    await expect(page.getByText(marker)).toBeVisible();
    await expect(page.getByText(/Edited by hand on/)).toBeVisible();
  });
});

test.describe("a student cannot rewrite the course", () => {
  test.use({ storageState: "e2e/.artifacts/student.json" });

  test("has no edit control, and the endpoint refuses them", async ({
    page,
    request,
  }) => {
    await page.goto(`/courses/${COURSE}`);
    await page.getByRole("link", { name: /The edge gateway/ }).first().click();
    await expect(
      page.getByRole("button", { name: "Edit this module" }),
    ).toHaveCount(0);

    // Not just hidden: the endpoint itself says no.
    const moduleId = page.url().split("/m/")[1]!;
    const res = await request.patch(
      `/api/courses/${COURSE}/modules/${moduleId}`,
      { data: { bodyMd: "owned" } },
    );
    expect(res.status()).toBe(403);
  });
});
