import { describe, expect, it } from "vitest";
import { chunkCode, chunkSource, isCodeSource, chunkText } from "@/lib/sources/chunk";

/**
 * The prose splitter cuts a long function in half; this one does not.
 *
 * A course meant to explain a codebase is only as good as what retrieval can
 * hand the writing stage. At 1200 characters split on blank lines, a function
 * of thirty lines or more arrived as two fragments, one with no signature and
 * one with no closing brace, and the module explaining it explained a piece.
 */

/** A function long enough that the prose splitter has to cut it. */
function longFunction(name: string, lines: number): string {
  const body = Array.from(
    { length: lines },
    (_, i) => `  const step${i} = compute(${i}, "a value long enough to matter here");`,
  ).join("\n");
  return `export function ${name}(input: string): number {\n${body}\n  return 0;\n}`;
}

describe("isCodeSource", () => {
  it("knows a source file by its extension", () => {
    for (const n of ["agent.ts", "main.py", "server.go", "lib/thing.rs", "a\\b\\x.rb"]) {
      expect(isCodeSource(n), n).toBe(true);
    }
  });

  it("knows the extensionless ones by convention", () => {
    expect(isCodeSource("Dockerfile")).toBe(true);
    expect(isCodeSource("deploy/Makefile")).toBe(true);
  });

  it("leaves prose alone", () => {
    for (const n of ["runbook.md", "notes.txt", "handover.docx", "https://wiki/x"]) {
      expect(isCodeSource(n), n).toBe(false);
    }
  });
});

describe("chunkCode", () => {
  it("keeps a function whole even when it is over the budget", () => {
    // The point of the whole change. This function is comfortably past the cap
    // and must still arrive in one piece, signature and closing brace included.
    const fn = longFunction("processEverything", 60);
    expect(fn.length).toBeGreaterThan(3000);

    const chunks = chunkCode(fn);
    const holding = chunks.filter((c) => c.text.includes("processEverything"));
    expect(holding).toHaveLength(1);
    expect(holding[0]!.text).toContain("export function processEverything");
    expect(holding[0]!.text.trimEnd().endsWith("}")).toBe(true);
  });

  it("is what the prose splitter could not do", () => {
    const fn = longFunction("processEverything", 60);
    const prose = chunkText(fn);
    // Stated as a fact about the old behaviour, so this test says why the new
    // one exists rather than only that it works.
    expect(prose.length).toBeGreaterThan(1);
    expect(chunkCode(fn).length).toBe(1);
  });

  it("keeps a docblock attached to what it introduces", () => {
    const src = [
      "/**",
      " * Why this exists, which is the context a reader needs most.",
      " */",
      "export function withDoc(): void {",
      "  run();",
      "}",
    ].join("\n");
    const chunks = chunkCode(src);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toContain("Why this exists");
    expect(chunks[0]!.text).toContain("export function withDoc");
  });

  it("packs small functions together rather than one chunk each", () => {
    const src = Array.from(
      { length: 8 },
      (_, i) => `function tiny${i}() {\n  return ${i};\n}`,
    ).join("\n\n");
    const chunks = chunkCode(src);
    expect(chunks.length).toBeLessThan(4);
    // Nothing lost in the packing.
    const all = chunks.map((c) => c.text).join("\n");
    for (let i = 0; i < 8; i++) expect(all).toContain(`function tiny${i}`);
  });

  it("does not treat a closing brace as the start of something new", () => {
    const src = "function a() {\n  x();\n}\nfunction b() {\n  y();\n}";
    const chunks = chunkCode(src, 10_000);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text).toBe(src);
  });

  it("splits a single block that is past the hard ceiling, by line", () => {
    // Somewhere there has to be a limit. Past it the pieces are still lines of
    // code rather than a run of characters cut mid-token.
    const huge = longFunction("enormous", 400);
    expect(huge.length).toBeGreaterThan(9000);
    const chunks = chunkCode(huge);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.startsWith(" ") || c.text.startsWith("export") || c.text.startsWith("  ")).toBe(
        true,
      );
      // No line was cut in half.
      expect(c.text.split("\n").every((l) => !l.endsWith("compute(") )).toBe(true);
    }
  });

  it("loses nothing", () => {
    const src = [longFunction("one", 20), longFunction("two", 20)].join("\n\n");
    const joined = chunkCode(src).map((c) => c.text).join("\n");
    for (const needle of ["export function one", "export function two", "return 0;"]) {
      expect(joined).toContain(needle);
    }
  });

  it("returns nothing for nothing", () => {
    expect(chunkCode("")).toEqual([]);
    expect(chunkCode("   \n\n  ")).toEqual([]);
  });

  it("numbers its chunks in order from zero", () => {
    const chunks = chunkCode(longFunction("x", 300));
    expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
  });
});

describe("chunkSource", () => {
  it("sends code to the code splitter and prose to the prose one", () => {
    const fn = longFunction("decideByName", 60);
    expect(chunkSource(fn, "agent.ts")).toHaveLength(1);
    // The same text under a prose name goes the old way, which cuts it.
    expect(chunkSource(fn, "notes.md").length).toBeGreaterThan(1);
  });

  it("chunks a real document the way it always did", () => {
    const prose = Array.from({ length: 12 }, () =>
      "Un paragrafo di prosa lungo abbastanza da contare per il budget del chunker.",
    ).join("\n\n");
    expect(chunkSource(prose, "runbook.md")).toEqual(chunkText(prose));
  });
});
