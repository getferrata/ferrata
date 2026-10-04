import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

/**
 * The accessibility checks a person would notice, run on the main pages in both
 * themes: text that cannot be read against its background, controls with no name,
 * a page with no heading.
 *
 * Found by using the product with axe-core running: the Contextia label on
 * Settings was 2.8:1 on the light surface, a select there had no name, and the
 * glossary page had no heading. Only these rules, so a failure is something a
 * person can be told about rather than a matter of taste.
 */
const axeSource = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);
const RULES = [
  "color-contrast",
  "select-name",
  "label",
  "button-name",
  "link-name",
  "image-alt",
  "page-has-heading-one",
];
const COURSE = "course_demo_acme";
// What proves a page has finished drawing itself. Settings builds its form after
// loading the saved configuration, and checking it before then checks an empty page.
const READY: Record<string, string> = { "/settings": "Provider" };
const PAGES = [
  "/courses",
  "/crea",
  "/import",
  "/settings",
  "/examiner",
  "/examiner/users",
  `/courses/${COURSE}`,
  `/courses/${COURSE}/dashboard`,
  `/courses/${COURSE}/glossary`,
  `/courses/${COURSE}/review`,
];

test.use({ storageState: "e2e/.artifacts/examiner.json" });

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    for (const path of PAGES) {
      test(`${path} passes the checks`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        if (READY[path]) {
          await expect(page.getByRole("heading", { name: READY[path] })).toBeVisible();
          await page.waitForTimeout(500);
        }
        await page.evaluate(axeSource);
        const violations = await page.evaluate(async (rules) => {
          // @ts-expect-error injected above
          const r = await window.axe.run(document, { runOnly: rules });
          return r.violations.flatMap((v: { id: string; nodes: { html: string; any: { data?: { fgColor?: string; bgColor?: string; contrastRatio?: number } }[] }[] }) =>
            v.nodes.map((n) => {
              const d = n.any[0]?.data;
              return `${v.id}: ${n.html.slice(0, 90)}${d?.contrastRatio ? ` (${d.fgColor} on ${d.bgColor} = ${d.contrastRatio})` : ""}`;
            }),
          );
        }, RULES);
        expect(violations).toEqual([]);
      });
    }
  });
}
