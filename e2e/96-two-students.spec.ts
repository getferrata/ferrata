import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
} from "@playwright/test";
import { STUDENT, STUDENT2 } from "./personas";

/**
 * Two students on one course must not see each other's progress. Everything
 * per-student (answers, readiness, the attempted count) is keyed by user id;
 * this proves it end to end in the browser, not just in the query unit tests.
 * Runs on a course of its own so no other spec's answers bleed into the counts.
 */

async function examinerApi(testInfo: {
  project: { use: { baseURL?: unknown } };
}): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/examiner.json",
  });
}

test.describe("two students on one course stay isolated", () => {
  test.setTimeout(240_000);

  test("one student's answers count for them only, never the other", async ({
    browser,
  }, testInfo) => {
    const ctx = await examinerApi(testInfo);

    // A course of its own, built through the mock pipeline.
    const created = await ctx.post("/api/courses", {
      multipart: {
        prompt: "Onboard two on-call engineers on the edge platform.",
        files: {
          name: "runbook.md",
          mimeType: "text/markdown",
          buffer: Buffer.from("# Runbook\nThe edge gateway terminates TLS."),
        },
      },
    });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const status = async () =>
      ((await (await ctx.get(`/api/courses/${id}`)).json()) as {
        course: { status: string };
      }).course.status;
    await expect
      .poll(status, { timeout: 60_000, intervals: [500, 1000] })
      .toBe("interview");
    await ctx.post(`/api/courses/${id}/interview`, { data: { answers: {} } });
    await expect
      .poll(status, { timeout: 60_000, intervals: [500, 1000] })
      .toBe("concept_review");
    await ctx.post(`/api/courses/${id}/concepts`, { data: { dropIds: [] } });
    await expect
      .poll(status, { timeout: 120_000, intervals: [500, 1000] })
      .toBe("ready");

    // Both students enrolled in the same course.
    for (const email of [STUDENT.email, STUDENT2.email]) {
      const r = await ctx.post(`/api/courses/${id}/enroll`, { data: { email } });
      if (r.status() !== 201) {
        throw new Error(`enroll ${email}: ${r.status()} ${await r.text()}`);
      }
    }

    // Student A answers exactly one anchor (the first, an open self-graded one).
    const ctxA = await browser.newContext({
      storageState: "e2e/.artifacts/student.json",
    });
    const a = await ctxA.newPage();
    await a.goto(`/courses/${id}`);
    await a.locator("ol li a").first().click();
    const firstAnchor = a.getByLabel("Anchors").locator("li").first();
    await firstAnchor.getByRole("button", { name: "Sure", exact: true }).first().click();
    await firstAnchor.getByRole("button", { name: "Show the answer" }).click();
    await firstAnchor.getByRole("button", { name: "I had it" }).click();
    await expect(firstAnchor.getByText("Right.")).toBeVisible();

    // A's dashboard counts that one answer as theirs.
    await a.goto(`/courses/${id}/dashboard`);
    await expect(a.getByText(/\b1\/\d+ questions attempted/)).toBeVisible();
    await expect(a.getByText(/Nothing has been tested yet/)).toHaveCount(0);

    // Student B never answered: their dashboard shows zero, not A's answer.
    // If readiness leaked across accounts, B would show 1 attempted here.
    const ctxB = await browser.newContext({
      storageState: "e2e/.artifacts/student2.json",
    });
    const b = await ctxB.newPage();
    await b.goto(`/courses/${id}/dashboard`);
    await expect(b.getByText(/Nothing has been tested yet/)).toBeVisible();
    await expect(b.getByText(/\b0\/\d+ questions attempted/)).toBeVisible();

    await ctxA.close();
    await ctxB.close();
    await ctx.dispose();
  });
});
