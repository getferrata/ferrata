import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests about the tests.
 *
 * The one that matters here was found by pointing the invariant checker at a
 * development database and reading what it said: ten ledger rows with a cost of
 * nine dollars against two hundred tokens. They were fixtures. Two test files
 * imported `@/db` without setting FERRATA_DB_PATH, which opens `./ferrata.db`,
 * and one of them cleared the whole llm_calls table in a beforeEach. Every run
 * of the suite was deleting the developer's real billing history, and the suite
 * reported green each time because from the inside it was working perfectly.
 */

const TEST_DIR = resolve(process.cwd(), "tests");

const testFiles = readdirSync(TEST_DIR).filter((f) => f.endsWith(".test.ts"));

describe("no test may touch the real database", () => {
  it("is guaranteed for every test file by the shared setup", () => {
    // The setup file is the guarantee, so this asserts it is still wired in
    // rather than asserting each file remembers to protect itself.
    const config = readFileSync(
      resolve(process.cwd(), "vitest.config.ts"),
      "utf8",
    );
    expect(config).toContain("tests/setup-db.ts");
    const setup = readFileSync(resolve(TEST_DIR, "setup-db.ts"), "utf8");
    expect(setup).toContain("FERRATA_DB_PATH");
  });

  it("points somewhere under the temp directory, never at the repo", () => {
    const path = process.env.FERRATA_DB_PATH ?? "";
    expect(path).not.toBe("");
    expect(path).not.toContain("ferrata.db-wal");
    // The check that would have caught it: the suite's database must not be the
    // one the app uses when you run pnpm dev.
    expect(resolve(path)).not.toBe(resolve(process.cwd(), "ferrata.db"));
  });

  it("has at least one file, or this whole guard is vacuous", () => {
    // A guard that passes because it found nothing to check is the failure mode
    // this file exists to avoid elsewhere; it applies here too.
    expect(testFiles.length).toBeGreaterThan(20);
  });
});

describe("a script that looks like a check has to be one", () => {
  const scripts: Record<string, string> = JSON.parse(
    readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
  ).scripts;

  it("runs files that exist", () => {
    // Cheap, and it catches the script that was renamed on one side only.
    const missing: string[] = [];
    for (const [name, cmd] of Object.entries(scripts)) {
      const file = /(?:tsx|node)\s+(\S+\.(?:ts|mjs|js))/.exec(cmd)?.[1];
      if (file && !existsSync(resolve(process.cwd(), file))) {
        missing.push(`${name} -> ${file}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has no lint script without a linter behind it", () => {
    // What this is here for: `pnpm lint` ran `next lint` for months against a
    // repo with no ESLint config and no ESLint dependency. Recent Next deprecated
    // the command, so it stopped even pretending and opened an interactive setup
    // prompt instead, which in CI is a hang and on a laptop is a menu. Nothing
    // failed, because nothing was ever checking. A gate nobody runs is a gap;
    // a gate that cannot run and reports nothing is worse, because the name in
    // package.json says the code has been linted.
    if (!scripts.lint) return;
    const configs = [
      "eslint.config.js",
      "eslint.config.mjs",
      "eslint.config.cjs",
      "eslint.config.ts",
      ".eslintrc.json",
      ".eslintrc.js",
      ".eslintrc.cjs",
    ];
    expect(configs.some((c) => existsSync(resolve(process.cwd(), c)))).toBe(true);
  });
});

describe("nothing in the source carries a byte nobody meant to type", () => {
  it("has no NUL in any source file, bar the one place it is the point", () => {
    // Cost of not having this: a marker written as a space turned out to be
    // U+0000, so a regex looking for a space never matched, the extractor
    // silently produced no figures, and the file read as binary to every tool
    // that touched it. Fifteen minutes to find, one line to catch.
    //
    // extract.ts is the exception and the reason is legitimate: it counts NUL
    // characters in decoded text to decide whether an uploaded file is binary,
    // so it has to contain one.
    const roots = ["src", "tests", "benchmarks", "scripts"];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
            walk(path);
          }
          continue;
        }
        if (!/\.(ts|tsx|md|json)$/.test(entry.name)) continue;
        // Separators normalised before comparing: the one file allowed to
        // carry a NUL is named the way a path reads, and on Windows the walk
        // produces backslashes, so the exemption missed and the check
        // reported the file it was written to excuse.
        if (path.split(sep).join("/").endsWith("src/lib/sources/extract.ts")) {
          continue;
        }
        if (readFileSync(path).includes(0)) offenders.push(path);
      }
    };
    // benchmarks/ is workshop-only and absent from the published package, where
    // this same suite runs. Counting what was actually walked rather than
    // silently skipping: a missing root is fine, all of them missing means the
    // check is looking at nothing and passing for it.
    let walked = 0;
    for (const r of roots) {
      const dir = resolve(process.cwd(), r);
      if (!existsSync(dir)) continue;
      walk(dir);
      walked += 1;
    }
    expect(walked, "no source root found to scan").toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });
});

describe("destructive statements stay inside a test database", () => {
  it("only ever deletes from a database the suite created", () => {
    // Any test may clear a table; what it must never do is clear one in the
    // real file. With the setup file in place that is structural, so this
    // records the intent and fails loudly if the setup is ever removed.
    const deleters = testFiles.filter((f) =>
      /db\s*\.\s*delete\s*\(/.test(readFileSync(resolve(TEST_DIR, f), "utf8")),
    );
    expect(deleters.length).toBeGreaterThan(0);
    expect(resolve(process.env.FERRATA_DB_PATH ?? "")).not.toBe(
      resolve(process.cwd(), "ferrata.db"),
    );
  });
});
