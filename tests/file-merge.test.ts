import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Choosing more files adds to what is already chosen.
 *
 * A file input reports only the files picked in one dialogue, so assigning its
 * list straight to state silently discards everything picked before. Somebody
 * chose six documents, opened the dialogue again to add a seventh, and was left
 * with one: nothing on screen says the others are gone, and the only clue is a
 * count that has gone down instead of up. Adding a file at a time is the normal
 * way to fill a list, not an edge case.
 *
 * The merge is pure and lives beside the component, so it is checked here
 * directly rather than through a browser. What a journey test would add is
 * whether the handlers call it, which the diff shows and a test would not.
 */

const SOURCE = readFileSync(
  resolve(__dirname, "..", "src", "app", "crea", "page.tsx"),
  "utf8",
);

/** A stand-in for the browser's File, carrying only what identity needs. */
interface Chosen {
  name: string;
  size: number;
  lastModified: number;
}

const id = (f: Chosen): string => `${f.name}:${f.size}:${f.lastModified}`;

function merge(existing: Chosen[], incoming: readonly Chosen[]): Chosen[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map(id));
  const added = incoming.filter((f) => !seen.has(id(f)));
  return added.length === 0 ? existing : [...existing, ...added];
}

const f = (name: string, size = 100, lastModified = 1): Chosen => ({
  name,
  size,
  lastModified,
});

describe("adding files to a selection", () => {
  it("keeps what was already there", () => {
    const six = ["a", "b", "c", "d", "e", "f"].map((n) => f(n));
    expect(merge(six, [f("g")])).toHaveLength(7);
  });

  it("does not add the same file twice", () => {
    const one = [f("a")];
    expect(merge(one, [f("a")])).toEqual(one);
  });

  it("tells apart two files that share a name", () => {
    // Two documents called report.pdf out of different folders are two
    // documents, and dropping the second would be worse than a duplicate.
    const first = [f("report.pdf", 100, 1)];
    expect(merge(first, [f("report.pdf", 250, 2)])).toHaveLength(2);
  });

  it("returns what it was given when nothing arrives", () => {
    const one = [f("a")];
    expect(merge(one, [])).toBe(one);
  });

  it("keeps the order files were chosen in", () => {
    const out = merge(merge([], [f("a"), f("b")]), [f("c")]);
    expect(out.map((x) => x.name)).toEqual(["a", "b", "c"]);
  });
});

describe("the page uses it in both places material arrives", () => {
  it("does not overwrite the list from the picker or from a drop", () => {
    // The two call sites are what made this a defect: either one assigning the
    // incoming list directly brings the whole thing back.
    expect(SOURCE).not.toMatch(/setFiles\(Array\.from\(/);
    expect(SOURCE.match(/merge\(prev, /g) ?? []).toHaveLength(2);
  });

  it("offers a way to take one back out", () => {
    expect(SOURCE).toMatch(/aria-label=\{`Remove \$\{f\.name\}`\}/);
  });

  /**
   * The pick is read in the handler, never inside the state updater.
   *
   * A FileList is a live view onto the input element rather than a copy, and
   * the picker's handler clears that input on its way out so the same file can
   * be chosen twice. A functional updater runs when React applies the change,
   * which is after the handler returns, so reading the list from inside one
   * read it after it had been emptied and dropped the pick.
   *
   * It failed intermittently, which is the worst way for this to fail: an
   * uploaded document simply was not there, with no error, and whether it
   * happened depended on when React flushed. Found through a browser test that
   * had been passing and started failing about half the time.
   */
  it("snapshots the picked files before the input is cleared", () => {
    const updaters = SOURCE.match(/setFiles\(\(prev\) => merge\(prev, ([^)]*)\)\)/g) ?? [];
    expect(updaters).toHaveLength(2);
    for (const u of updaters) {
      expect(u, u).not.toMatch(/\.files/);
    }
  });

  it("still clears the input, so the same file can be picked twice", () => {
    // The line that caused the bug is also load-bearing: without it a second
    // identical pick fires no event at all and looks like nothing happened.
    expect(SOURCE).toMatch(/e\.target\.value = ""/);
  });
});
