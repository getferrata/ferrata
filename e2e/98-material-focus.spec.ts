import { test, expect, request as pwRequest } from "@playwright/test";
import { wait } from "./timeouts";

/**
 * What the planner is shown of the attached material.
 *
 * Every source used to be represented by whichever chunk was ingested first,
 * which for a code file is the import block and for a document the title page.
 * A course planned from a repository's worth of headers is the definition of
 * the thing this product exists not to produce, and no unit test can prove the
 * fix is wired: the function can pick the right passage and the handler still
 * pass the old argument.
 *
 * So the mock reads the material turn and adds a concept only when a phrase
 * buried below the boilerplate is in front of it. The concept appearing on the
 * review screen is the proof that the passage travelled the whole way.
 */

// Long enough to fill several retrieval chunks on its own, so the passage
// below cannot land in the first one. That is the shape of a real file: the
// interesting paragraph is never at the top.
const BOILERPLATE = Array.from(
  { length: 8 },
  (_, i) =>
    `Section ${i}. Copyright notice and the usual licence paragraph, repeated ` +
    "at the top of every file in this repository, saying nothing whatever " +
    "about what the file does or when anything in it runs. " +
    "Imports, type aliases and re-exports follow. ".repeat(6),
).join("\n\n");

const BURIED = [
  "The payment gateway trips a circuit breaker at the payment edge when the",
  "acquirer's error rate crosses two percent, so the checkout queue drains",
  "instead of piling up against a bank that is already refusing.",
].join("\n");

test.use({ storageState: "e2e/.artifacts/examiner.json" });

test("the planner sees the passage the brief asks about, not the file header", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const ctx = await pwRequest.newContext({
    baseURL: testInfo.project.use.baseURL as string,
    storageState: "e2e/.artifacts/examiner.json",
  });

  const created = await ctx.post("/api/courses", {
    multipart: {
      // The brief names the thing that is buried, and nothing that is on top.
      prompt:
        "Teach the on-call engineer what the payment circuit breaker does and when it opens.",
      files: {
        name: "payments.ts",
        mimeType: "text/plain",
        // Boilerplate first, by more than one chunk, then the passage. Picking
        // the first chunk misses it; picking the passage that matches the brief
        // finds it.
        buffer: Buffer.from(`${BOILERPLATE}\n\n${BURIED}\n`),
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

  await page.goto(`/courses/${id}`);
  await expect(
    page.getByRole("heading", { name: "Review the plan before building" }),
  ).toBeVisible();
  await expect(page.getByText("The payment circuit breaker")).toBeVisible();
  await page.screenshot({
    path: "e2e/.artifacts/shots/57-planned-from-the-material.png",
    fullPage: true,
  });

  await ctx.dispose();
});
