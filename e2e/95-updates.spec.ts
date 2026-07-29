import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";

/**
 * Reworking a finished course: assessed mode, new material becoming proposals,
 * the author's decisions applying them, and the single-module rewrite. Runs on
 * a course of its own built through the mock pipeline, so nothing here touches
 * the shared demo course other specs read.
 */

const NEW_MATERIAL = [
  "# Gateway changes, June",
  "",
  "The health check moved from /healthz to /livez.",
  "A rate limiter now sits in front of the pool and sheds load early.",
].join("\n");

async function examinerCtx(testInfo: {
  project: { use: { baseURL?: unknown } };
}): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/examiner.json",
  });
}

test.describe("reworking a finished course", () => {
  test.use({ storageState: "e2e/.artifacts/examiner.json" });
  // One long journey on one course: build, toggle, add material, decide, rewrite.
  test.setTimeout(240_000);

  test("new material becomes proposals, and only approval changes the course", async ({
    page,
  }, testInfo) => {
    const ctx = await examinerCtx(testInfo);

    // Build a course through the mock pipeline, API-side (the UI path is
    // 1-journey's job; here the course is scaffolding).
    const created = await ctx.post("/api/courses", {
      multipart: {
        prompt: "Onboard the on-call engineer on the edge platform.",
        files: {
          name: "runbook.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("# Runbook\nThe edge gateway terminates TLS."),
        },
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const courseStatus = async () => {
      const res = await ctx.get(`/api/courses/${id}`);
      return ((await res.json()) as { course: { status: string } }).course.status;
    };
    await expect
      .poll(courseStatus, { timeout: 60_000, intervals: [500, 1000] })
      .toBe("interview");
    expect(
      (await ctx.post(`/api/courses/${id}/interview`, { data: { answers: {} } })).ok(),
    ).toBeTruthy();
    await expect
      .poll(courseStatus, { timeout: 60_000, intervals: [500, 1000] })
      .toBe("concept_review");
    expect(
      (await ctx.post(`/api/courses/${id}/concepts`, { data: { dropIds: [] } })).ok(),
    ).toBeTruthy();
    await expect
      .poll(courseStatus, { timeout: 120_000, intervals: [500, 1000] })
      .toBe("ready");

    // Assessed mode is the author's choice, from the course page.
    await page.goto(`/courses/${id}`);
    await page.getByRole("button", { name: "Assessed" }).click();
    await expect(
      page.getByText(/Readiness counts only answers the system checked/),
    ).toBeVisible();
    await page.goto(`/courses/${id}/dashboard`);
    await expect(page.getByText(/Assessed course:/)).toBeVisible();

    // The answer key is not on the page: assessed readiness is a measurement,
    // so the model answer for a system-graded question must not be readable in
    // the source before the student answers. The mock cloze answers with this
    // distinctive phrase; it must be absent.
    await page.goto(`/courses/${id}`);
    await page.getByRole("link", { name: /The edge gateway/ }).first().click();
    const source = await page.content();
    expect(source).not.toContain("no healthy backend to route to");

    // New material goes in through the same gate as at creation.
    const added = await ctx.post(`/api/courses/${id}/sources`, {
      multipart: {
        files: {
          name: "changes.md",
          mimeType: "text/markdown",
          buffer: Buffer.from(NEW_MATERIAL),
        },
      },
    });
    expect(added.status()).toBe(201);
    expect(((await added.json()) as { queued: boolean }).queued).toBe(true);

    // Open the course straight away, the way an author does: the panel must
    // fill itself in as the analysis finishes, with no manual reload. The old
    // test pre-polled the API until the job was done and only then opened the
    // page, which hid the fact that the page never refreshed on its own.
    await page.goto(`/courses/${id}`);
    const panel = page.getByLabel("Proposed changes", { exact: false });
    await expect(panel).toBeVisible();
    // Three proposals arrive on their own (mock: update, add, retire). Each card
    // carries both actions, so three cards mean three Approve buttons: this is
    // the poll working, since the page was opened before the job had finished.
    await expect(panel.getByRole("button", { name: "Approve" })).toHaveCount(3, {
      timeout: 60_000,
    });
    await expect(panel.locator("li", { hasText: "Retire" })).toBeVisible();

    // Decisions, from the page. Approve the addition, dismiss the retirement,
    // approve the update.

    await panel
      .locator("li", { hasText: "Rate limiting at the edge" })
      .getByRole("button", { name: "Approve" })
      .click();
    await panel
      .locator("li", { hasText: "Retire" })
      .getByRole("button", { name: "Dismiss" })
      .click();
    await panel
      .locator("li", { hasText: "Update" })
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(panel.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // The approvals land: four concepts, four modules, and both rewrites done.
    // Settled means stable: a module mid-rewrite reads as done for a moment.
    const settled = async () => {
      const read = async () => {
        const res = await ctx.get(`/api/courses/${id}`);
        const d = (await res.json()) as { conceptCount: number; modulesDone: number };
        return d.conceptCount === 4 && d.modulesDone === 4;
      };
      if (!(await read())) return false;
      await new Promise((r) => setTimeout(r, 1500));
      return read();
    };
    await expect
      .poll(settled, { timeout: 120_000, intervals: [1000, 2000] })
      .toBe(true);

    await page.goto(`/courses/${id}`);
    // The dismissed retirement changed nothing; the addition is a real module.
    await expect(
      page.getByRole("link", { name: /Rate limiting at the edge/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /The edge gateway/ }),
    ).toBeVisible();

    // The direct rewrite path: same job, reached from the module page, with
    // the costs stated before anything is queued.
    await page.getByRole("link", { name: /The edge gateway/ }).click();
    // The module keeps its address across a rewrite, so this URL must still
    // resolve afterwards rather than 404 on a fresh id.
    const moduleUrl = page.url();
    await page.getByRole("button", { name: "Rewrite with the model" }).click();
    await expect(
      page.getByText(/Answers students already gave on this module/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Rewrite it" }).click();
    // The button stays on the module page now (no bounce to the overview): the
    // rewrite runs in the background and the page swaps in the new body itself.
    await expect
      .poll(settled, { timeout: 120_000, intervals: [1000, 2000] })
      .toBe(true);

    // Same URL, still the module: the rewrite reused the id, so a reader sitting
    // on the page (or a bookmark) is not sent to a dead address.
    await page.goto(moduleUrl);
    await expect(
      page.getByRole("heading", { name: /The edge gateway/ }),
    ).toBeVisible();

    await ctx.dispose();
  });
});

test.describe("students cannot rework a course", () => {
  test("the add-material endpoint refuses them", async ({}, testInfo) => {
    const ctx = await pwRequest.newContext({
      baseURL: testInfo.project.use.baseURL as string,
      storageState: "e2e/.artifacts/student.json",
    });
    const res = await ctx.post(`/api/courses/course_demo_acme/sources`, {
      multipart: { text: "sneaky" },
    });
    expect(res.status()).toBe(403);
    await ctx.dispose();
  });
});
