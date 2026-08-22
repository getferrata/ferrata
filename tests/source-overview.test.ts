import { afterEach, describe, expect, it } from "vitest";
import { overviewBudget, sourceOverview } from "@/lib/sources/query";
import type { ChunkDoc } from "@/lib/sources/retrieve";

function repo(fileCount: number, chunksPerFile = 3): ChunkDoc[] {
  const out: ChunkDoc[] = [];
  for (let f = 0; f < fileCount; f++) {
    for (let c = 0; c < chunksPerFile; c++) {
      out.push({
        sourceId: `s${f}`,
        sourceName: `packages/thing/src/file-${f}.ts`,
        ord: c,
        // Long enough that a naive overview would spend its whole budget on the
        // first couple of files, which is exactly the bug this pins.
        text: `contents of file ${f} chunk ${c}. ${"lorem ipsum ".repeat(60)}`,
      });
    }
  }
  return out;
}

describe("the overview the planning stages read", () => {
  it("lists every source when they fit", () => {
    const overview = sourceOverview(repo(6, 1));
    expect(overview).toContain("6 sources");
    expect(overview).toContain("file-0.ts");
    expect(overview).toContain("file-5.ts");
  });

  it("rolls a large repository up by folder rather than cutting the list", () => {
    // A truncated list shows the first handful and silently implies the rest do
    // not exist, which is how a planner concludes the material does not cover
    // the subject. The folder names carry the architecture in a fraction of the
    // space, and the total is stated outright.
    const overview = sourceOverview(repo(131), 3500);
    expect(overview).toContain("131 sources");
    expect(overview).toMatch(/packages\/thing\/src\/ \(131 files\)/);
  });

  it("lists all 131 paths outright when the budget can afford them", () => {
    // The rollup was always the lesser answer, taken because 3500 characters
    // could not hold the paths. At the budget a hosted model actually gets,
    // they cost about 5000 characters and the planner sees the real tree.
    const overview = sourceOverview(repo(131));
    expect(overview).toContain("file-0.ts");
    expect(overview).toContain("file-130.ts");
    expect(overview).not.toContain("more folders");
  });

  it("does not spend the whole budget on the first files it meets", () => {
    // The defect: a course built on 131 files was planned from the two that
    // happened to be ingested first, and the stages downstream concluded the
    // material did not cover the subject when it did.
    const overview = sourceOverview(repo(131));
    const excerpted = [...overview.matchAll(/^### /gm)].length;
    expect(excerpted).toBeGreaterThan(2);
  });

  it("stays within the cap it was given", () => {
    expect(sourceOverview(repo(131), 3500).length).toBeLessThanOrEqual(3500);
    expect(sourceOverview(repo(131), 9000).length).toBeLessThanOrEqual(9000);
    expect(sourceOverview(repo(131)).length).toBeLessThanOrEqual(
      overviewBudget(),
    );
  });

  it("still shows real text for a small attachment", () => {
    const overview = sourceOverview(repo(2, 1));
    expect(overview).toContain("contents of file 0");
    expect(overview).toContain("contents of file 1");
  });

  it("says nothing when nothing is attached", () => {
    expect(sourceOverview([])).toBe("");
  });

  it("keeps the excerpts alive even on a huge, wide repository", () => {
    // Many folders as well as many files: the rollup itself has to be bounded,
    // or the inventory eats the budget and nothing is quoted at all.
    const wide: ChunkDoc[] = [];
    for (let d = 0; d < 90; d++) {
      wide.push({
        sourceId: `s${d}`,
        sourceName: `packages/pkg-${d}/src/deep/nested/path/index.ts`,
        ord: 0,
        text: `file in package ${d}. ${"lorem ipsum ".repeat(40)}`,
      });
    }
    const overview = sourceOverview(wide, 3500);
    expect(overview).toContain("90 sources");
    expect(overview).toContain("more folders");
    expect(overview).toContain("## Excerpts");
    expect(overview.length).toBeLessThanOrEqual(3500);
  });
});

describe("choosing which passage stands for a source", () => {
  /** Two files: one about the subject, one not, each with a dull first chunk. */
  function corpus(): ChunkDoc[] {
    return [
      {
        sourceId: "a",
        sourceName: "src/imports.ts",
        ord: 0,
        text: "import { readFile } from 'node:fs';\nimport path from 'node:path';",
      },
      {
        sourceId: "a",
        sourceName: "src/imports.ts",
        ord: 1,
        text: "The failover controller moves the virtual address between gateways using VRRP.",
      },
      {
        sourceId: "b",
        sourceName: "src/unrelated.ts",
        ord: 0,
        text: "Formatting helpers for invoice dates and currency symbols.",
      },
    ];
  }

  it("quotes the passage about the brief, not the imports at the top", () => {
    // The defect this fixes: every source was represented by whichever chunk
    // was ingested first. For a code file that is the import block, for a
    // document the title page, and the planner reads a course's worth of
    // headers and concludes the material says nothing.
    const overview = sourceOverview(corpus(), {
      focus: "how failover moves the virtual address",
      maxChars: 1200,
    });
    expect(overview).toContain("VRRP");
  });

  it("falls back to the first chunk when nothing is asked", () => {
    const overview = sourceOverview(corpus(), { maxChars: 1200 });
    expect(overview).toContain("import { readFile }");
  });

  it("puts the sources the brief is about first", () => {
    // What decides which sources survive the budget on a large corpus.
    const overview = sourceOverview(corpus(), {
      focus: "failover and the virtual address",
      maxChars: 1200,
    });
    const relevant = overview.indexOf("### src/imports.ts");
    const other = overview.indexOf("### src/unrelated.ts");
    expect(relevant).toBeGreaterThan(-1);
    expect(other).toBeGreaterThan(relevant);
  });

  it("still lists every source, however irrelevant", () => {
    // Ordering excerpts is not the same as hiding files. "This exists and is
    // about something else" is information the planner needs.
    const overview = sourceOverview(corpus(), {
      focus: "failover",
      maxChars: 1200,
    });
    expect(overview).toContain("src/unrelated.ts");
    expect(overview).toContain("2 sources");
  });

  it("keeps the inventory in ingestion order, whatever the brief says", () => {
    // For a repository the path order is the map of the thing. Reordering it by
    // relevance would make the inventory harder to read to no benefit: it is
    // not the part competing for the budget.
    const overview = sourceOverview(corpus(), {
      focus: "failover",
      maxChars: 1200,
    });
    const listing = overview.slice(0, overview.indexOf("## Excerpts"));
    expect(listing.indexOf("src/imports.ts")).toBeLessThan(
      listing.indexOf("src/unrelated.ts"),
    );
  });

  it("survives a brief that matches nothing at all", () => {
    const overview = sourceOverview(corpus(), {
      focus: "quantum chromodynamics",
      maxChars: 1200,
    });
    expect(overview).toContain("src/imports.ts");
    expect(overview).toContain("src/unrelated.ts");
  });
});

describe("how much material the planner is allowed to read", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
  });

  it("gives a hosted model room, because input is the cheap half", () => {
    delete process.env.FERRATA_LITE;
    delete process.env.FERRATA_OVERVIEW_CHARS;
    expect(overviewBudget()).toBeGreaterThan(3500);
  });

  it("keeps the old figure in lite mode, which means a small model", () => {
    delete process.env.FERRATA_OVERVIEW_CHARS;
    process.env.FERRATA_LITE = "1";
    expect(overviewBudget()).toBe(3500);
  });

  it("takes an explicit override over both", () => {
    process.env.FERRATA_LITE = "1";
    process.env.FERRATA_OVERVIEW_CHARS = "20000";
    expect(overviewBudget()).toBe(20_000);
  });

  it("ignores an override too small to say anything", () => {
    // A typo that left the planner reading fifty characters of a repository
    // would produce a plausible course about nothing.
    delete process.env.FERRATA_LITE;
    process.env.FERRATA_OVERVIEW_CHARS = "50";
    expect(overviewBudget()).toBeGreaterThan(3500);
  });
});
