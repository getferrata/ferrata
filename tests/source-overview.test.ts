import { describe, expect, it } from "vitest";
import { sourceOverview } from "@/lib/sources/query";
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
    const overview = sourceOverview(repo(131));
    expect(overview).toContain("131 sources");
    expect(overview).toMatch(/packages\/thing\/src\/ \(131 files\)/);
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
    const overview = sourceOverview(repo(131));
    expect(overview.length).toBeLessThanOrEqual(3500);
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
    const overview = sourceOverview(wide);
    expect(overview).toContain("90 sources");
    expect(overview).toContain("more folders");
    expect(overview).toContain("## Excerpts");
    expect(overview.length).toBeLessThanOrEqual(3500);
  });
});
