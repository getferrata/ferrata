import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { STUDENT, STUDENT2 } from "./personas";
import { wait } from "./timeouts";

/**
 * The loop closing: two students fail the same machine-graded question, the
 * examiner's dashboard names the module as weak for the class and offers to
 * rewrite it against what they got wrong, and the rewrite actually lands.
 *
 * On a course of its own, because it deliberately puts wrong answers on the
 * record and rewrites a module out from under them, and neither belongs in the
 * shared demo course other specs read.
 */

const SHOTS = "e2e/.artifacts/shots";

async function examinerApi(testInfo: {
  project: { use: { baseURL?: unknown } };
}): Promise<APIRequestContext> {
  return pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/examiner.json",
  });
}

/** Answer the module's multiple choice question wrong, and mean it. */
async function failTheMcq(page: Page, courseId: string): Promise<void> {
  await page.goto(`/courses/${courseId}`);
  await page.locator("ol li a").first().click();
  const mcq = page
    .getByLabel("Anchors")
    .locator("li")
    .filter({ hasText: "Which service terminates inbound TLS?" })
    .first();
  // Confidence first, as every other answer path does: a wrong answer given
  // confidently is the one the product cares about.
  await mcq.getByRole("button", { name: "Sure", exact: true }).first().click();
  await mcq.getByRole("radio").nth(0).check();
  const chosen = await mcq.locator("label").nth(0).innerText();
  // The options are shuffled per question id, so pick by text rather than
  // trusting a position, and only settle for one that is actually wrong.
  if (chosen.includes("edge gateway")) {
    await mcq.getByRole("radio").nth(1).check();
  }
  await mcq.getByRole("button", { name: "Answer" }).click();
  await expect(mcq.getByText(/Sure and wrong/)).toBeVisible();
}

test.describe("a module most of the class fails offers to rewrite itself", () => {
  test.setTimeout(300_000);

  test("from two wrong answers to a rewritten module", async ({
    browser,
  }, testInfo) => {
    const ctx = await examinerApi(testInfo);

    const created = await ctx.post("/api/courses", {
      multipart: {
        prompt: "Onboard the on-call engineers on the edge platform.",
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
      (
        (await (await ctx.get(`/api/courses/${id}`)).json()) as {
          course: { status: string };
        }
      ).course.status;
    await expect
      .poll(status, { timeout: wait(60), intervals: [500, 1000] })
      .toBe("interview");
    await ctx.post(`/api/courses/${id}/interview`, { data: { answers: {} } });
    await expect
      .poll(status, { timeout: wait(60), intervals: [500, 1000] })
      .toBe("concept_review");
    await ctx.post(`/api/courses/${id}/concepts`, { data: { dropIds: [] } });
    await expect
      .poll(status, { timeout: wait(120), intervals: [500, 1000] })
      .toBe("ready");

    for (const email of [STUDENT.email, STUDENT2.email]) {
      const r = await ctx.post(`/api/courses/${id}/enroll`, { data: { email } });
      if (r.status() !== 201) {
        throw new Error(`enroll ${email}: ${r.status()} ${await r.text()}`);
      }
    }

    // Both students get the same machine-graded question wrong. Machine-graded
    // on purpose: a self-graded answer is the reader's opinion of themselves,
    // and must not be able to trigger a paid rewrite.
    for (const state of ["student.json", "student2.json"]) {
      const sctx = await browser.newContext({
        storageState: `e2e/.artifacts/${state}`,
      });
      await failTheMcq(await sctx.newPage(), id);
      await sctx.close();
    }

    // The examiner's dashboard names it, counts it, and offers the rewrite.
    const ectx = await browser.newContext({
      storageState: "e2e/.artifacts/examiner.json",
    });
    const page = await ectx.newPage();
    await page.goto(`/courses/${id}/dashboard`);
    await expect(
      page.getByRole("heading", { name: "Weak for most of the class" }),
    ).toBeVisible();
    const weak = page.locator("li", { hasText: "weak for 2 of 2" }).first();
    await expect(weak).toBeVisible();
    // The count is the point: it is what the writer would be handed, and a row
    // that could not say it should not be offering a paid rewrite.
    await expect(weak.getByText(/1 question most of them fail/)).toBeVisible();
    await page.screenshot({
      path: `${SHOTS}/58-weak-for-the-class.png`,
      fullPage: true,
    });

    // The block gained a button, and a button next to a right-aligned count is
    // the shape that pushes a phone sideways. The mobile spec cannot catch it:
    // the demo course it walks has no class weak enough to render this.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(weak).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: `${SHOTS}/58-weak-for-the-class-phone.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });

    // It asks before spending, and says what it costs and what it clears.
    await weak
      .getByRole("button", { name: "Rewrite against what they got wrong" })
      .click();
    await expect(
      page.getByText(/The writer is given the 1 question/),
    ).toBeVisible();
    await expect(page.getByText(/clears the answers already given/)).toBeVisible();
    await page.screenshot({
      path: `${SHOTS}/58-rewrite-confirm.png`,
      fullPage: true,
    });

    // Backing out spends nothing and leaves the row alone.
    await page.getByRole("button", { name: "Keep it as it is" }).click();
    await expect(page.getByText(/The writer is given the/)).toHaveCount(0);
    await expect(weak).toBeVisible();

    await weak
      .getByRole("button", { name: "Rewrite against what they got wrong" })
      .click();
    await page.getByRole("button", { name: "Rewrite it" }).click();
    await expect(page.getByText(/Rewriting\./)).toBeVisible();
    await page.screenshot({
      path: `${SHOTS}/58-rewrite-queued.png`,
      fullPage: true,
    });

    // And it lands. The rewrite retires the questions the class failed and
    // writes new ones, so the concept goes back to untested and drops off the
    // weak list. Polling the page the author is actually looking at, rather
    // than a job table, is the assertion that would catch a rewrite that
    // queued and then quietly did nothing.
    await expect
      .poll(
        async () => {
          await page.goto(`/courses/${id}/dashboard`);
          return page
            .getByRole("heading", { name: "Weak for most of the class" })
            .count();
        },
        { timeout: wait(180), intervals: [2000, 3000] },
      )
      .toBe(0);
    await page.screenshot({
      path: `${SHOTS}/58-after-rewrite.png`,
      fullPage: true,
    });

    // And what replaced it is a module a student can actually be tested on.
    // Worth checking separately: a rewrite that produced a body but no tests
    // would also empty the weak list, by making the concept unmeasurable
    // rather than by fixing it, and the poll above cannot tell those apart.
    const sctx = await browser.newContext({
      storageState: "e2e/.artifacts/student.json",
    });
    const s = await sctx.newPage();
    await s.goto(`/courses/${id}`);
    await s.locator("ol li a").first().click();
    const anchors = s.getByLabel("Anchors");
    await expect(anchors).toBeVisible();
    expect(await anchors.locator("li").count()).toBeGreaterThan(0);
    await sctx.close();

    await ectx.close();
    await ctx.dispose();
  });

  test("a student cannot ask for a rewrite, with or without the flag", async ({
    browser,
  }) => {
    // The flag is the cheap part; the spend is not. Both shapes of the request
    // have to be refused for the same reason: a student is not an examiner.
    // Worth its own probe because the flag arrived after the access checks did,
    // and a body that changes what an endpoint costs is exactly the kind of
    // thing that gets read before the role is.
    const sctx = await browser.newContext({
      storageState: "e2e/.artifacts/student.json",
    });
    for (const data of [{}, { useFailures: true }]) {
      const res = await sctx.request.post(
        "/api/courses/course_demo_acme/modules/module_demo_0/regenerate",
        { data, maxRedirects: 0, failOnStatusCode: false },
      );
      expect(res.status(), JSON.stringify(data)).not.toBe(200);
    }
    await sctx.close();
  });
});
