import { test, expect } from "@playwright/test";

/**
 * Phone-sized regression guard. Two properties that break easily and quietly:
 * the page must not scroll sideways, and a standalone control must stay big
 * enough to hit with a thumb. Links that sit inside a sentence are exempt,
 * since padding them out would break the line.
 */

const COURSE = "course_demo_acme";
const PHONE = { width: 375, height: 812 };

const EXAMINER_PAGES = [
  "/courses",
  "/crea",
  `/courses/${COURSE}`,
  `/courses/${COURSE}/dashboard`,
  `/courses/${COURSE}/glossary`,
  `/courses/${COURSE}/review`,
  "/examiner",
  "/examiner/users",
  "/settings",
  "/import",
];

/** Elements wider than the viewport, with enough detail to find the culprit. */
async function overflowing(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= window.innerWidth + 1) return [];
    const guilty: string[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 && r.width > 0) {
        guilty.push(`${el.tagName} right=${Math.round(r.right)}`);
      }
    });
    return guilty.slice(0, 4);
  });
}

/** Standalone controls shorter than 28px. */
async function tinyTargets(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const inlineInText = (el: Element) => {
      if (el.tagName !== "A") return false;
      const parent = el.parentElement;
      if (!parent) return false;
      if (!["P", "SPAN", "LI", "LABEL", "TD"].includes(parent.tagName)) return false;
      const own = (el.textContent ?? "").trim();
      const all = (parent.textContent ?? "").trim();
      return all.length > own.length + 3;
    };
    const visuallyHidden = (el: Element) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return (
        s.opacity === "0" ||
        s.clipPath.includes("inset(50%)") ||
        (s.position === "absolute" && r.height <= 1)
      );
    };
    // A small checkbox inside a tall label is fine: the label is the target.
    const labelled = (el: Element) => {
      if (el.tagName !== "INPUT") return false;
      const lab =
        el.closest("label") ??
        (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      return !!lab && lab.getBoundingClientRect().height >= 28;
    };
    const out: string[] = [];
    document.querySelectorAll("button, a, input, select").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (
        r.width > 0 &&
        r.height > 0 &&
        r.height < 28 &&
        !inlineInText(el) &&
        !visuallyHidden(el) &&
        !labelled(el)
      ) {
        out.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 24)}" h=${Math.round(r.height)}`);
      }
    });
    return out.slice(0, 5);
  });
}

test.describe("phone layout", () => {
  test.use({
    storageState: "e2e/.artifacts/examiner.json",
    viewport: PHONE,
    isMobile: true,
  });

  for (const path of EXAMINER_PAGES) {
    test(`no sideways scroll and no cramped controls on ${path}`, async ({ page }) => {
      await page.goto(path, { waitUntil: "networkidle" });
      expect(await overflowing(page), `${path} scrolls sideways`).toEqual([]);
      expect(await tinyTargets(page), `${path} has controls under 28px`).toEqual([]);
    });
  }

  test("a module reads on a phone", async ({ page }) => {
    // The screen a learner actually spends their time on, and the one with the
    // most that can overflow: prose, a prerequisite map, code blocks, tables,
    // the tests, and the explain-back panel.
    await page.goto(`/courses/${COURSE}`, { waitUntil: "networkidle" });
    const first = page.locator(`a[href*="/courses/${COURSE}/m/"]`).first();
    await expect(first).toBeVisible();
    const href = await first.getAttribute("href");
    expect(href, "no module link on the course page").toBeTruthy();

    await page.goto(href as string, { waitUntil: "networkidle" });
    expect(await overflowing(page), "the module page scrolls sideways").toEqual([]);
    expect(await tinyTargets(page), "the module page has cramped controls").toEqual([]);

    // With the route map open, which is where the widest element lives.
    const summary = page.locator("summary").filter({ hasText: "Where you are" });
    if (await summary.count()) {
      await summary.first().click();
      await page.waitForTimeout(300);
      expect(
        await overflowing(page),
        "the prerequisite map pushes the page sideways",
      ).toEqual([]);
    }
  });

  test("the main menu is reachable without a wider screen", async ({ page }) => {
    await page.goto("/courses", { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation", { name: "Main" }).last();
    await expect(nav.getByRole("link", { name: "Settings" })).toBeVisible();
  });
});
