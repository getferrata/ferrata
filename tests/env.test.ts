import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv, loadLocalEnv } from "@/lib/env";

describe("parseEnv", () => {
  it("reads the plain form", () => {
    expect(parseEnv("A=1\nB=two")).toEqual({ A: "1", B: "two" });
  });

  it("ignores blanks and comments", () => {
    expect(parseEnv("\n# a note\n\nA=1\n   # indented\n")).toEqual({ A: "1" });
  });

  it("strips quotes and honours newlines only inside double ones", () => {
    expect(parseEnv(`A="one\\ntwo"\nB='one\\ntwo'`)).toEqual({
      A: "one\ntwo",
      B: "one\\ntwo",
    });
  });

  it("takes the export prefix people paste from a shell", () => {
    expect(parseEnv("export A=1")).toEqual({ A: "1" });
  });

  it("drops a trailing comment but keeps a hash inside the value", () => {
    // An API key with a hash in it is not a comment, and treating it as one
    // truncates the key into something that fails at the provider.
    expect(parseEnv("A=value # why\nB=sk-ant-a#b#c")).toEqual({
      A: "value",
      B: "sk-ant-a#b#c",
    });
  });

  it("keeps an equals sign that belongs to the value", () => {
    expect(parseEnv("A=base64==")).toEqual({ A: "base64==" });
  });

  it("skips a line that is not a name and a value", () => {
    expect(parseEnv("nonsense\n=1\n1BAD=x\nA=1")).toEqual({ A: "1" });
  });
});

describe("loadLocalEnv", () => {
  let dir: string;
  const touched = ["FERRATA_TEST_ONE", "FERRATA_TEST_TWO", "FERRATA_TEST_SET"];

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ferrata-env-"));
    for (const k of touched) delete process.env[k];
  });
  afterEach(() => {
    for (const k of touched) delete process.env[k];
  });

  it("does nothing when there is no file", () => {
    expect(loadLocalEnv(dir)).toEqual([]);
  });

  it("sets what the file names", () => {
    writeFileSync(join(dir, ".env.local"), "FERRATA_TEST_ONE=from-local\n");
    expect(loadLocalEnv(dir)).toEqual(["FERRATA_TEST_ONE"]);
    expect(process.env.FERRATA_TEST_ONE).toBe("from-local");
  });

  it("never replaces something already set", () => {
    // A value passed on the command line is a deliberate override for that one
    // run, and a file quietly undoing it is the kind of thing nobody debugs.
    process.env.FERRATA_TEST_SET = "from-the-command-line";
    writeFileSync(join(dir, ".env.local"), "FERRATA_TEST_SET=from-the-file\n");
    expect(loadLocalEnv(dir)).toEqual([]);
    expect(process.env.FERRATA_TEST_SET).toBe("from-the-command-line");
  });

  it("prefers .env.local over .env, same as the server", () => {
    writeFileSync(join(dir, ".env"), "FERRATA_TEST_ONE=plain\nFERRATA_TEST_TWO=only-plain\n");
    writeFileSync(join(dir, ".env.local"), "FERRATA_TEST_ONE=local\n");
    loadLocalEnv(dir);
    expect(process.env.FERRATA_TEST_ONE).toBe("local");
    expect(process.env.FERRATA_TEST_TWO).toBe("only-plain");
  });
});

describe("every command line entry point loads the env", () => {
  // The bug this guards against cost an afternoon and produced a course file
  // with the protected values deleted out of it. The server gets .env.local
  // from Next; a script run with tsx gets nothing, and the failure is silent
  // in both directions: the wrong database, or values that will not decrypt.
  //
  // Derived from package.json rather than listed here. A hand-written list is
  // the same memory that was missing in the first place, and it also has to
  // stay right in two trees at once, since the release package deletes some of
  // these scripts and would fail on a name that no longer exists.
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<
    string,
    string
  >;

  const entryPoints = Object.entries(scripts)
    .map(([name, cmd]) => ({ name, file: /^tsx\s+(\S+)$/.exec(cmd)?.[1] }))
    .filter((e): e is { name: string; file: string } => e.file !== undefined)
    .filter(({ file }) => existsSync(file))
    // Only the ones that open the database or read the install's own settings.
    // Those are the two things .env.local decides, so those are the two
    // reasons a command needs it.
    .filter(({ file }) => {
      const src = readFileSync(file, "utf8");
      return src.includes('from "@/db"') || src.includes('from "./index"') ||
        src.includes("process.env.FERRATA_");
    });

  it("finds some, so a broken filter cannot make this pass by matching nothing", () => {
    // Low on purpose, and the low number is the point: the release package
    // drops the commands that need private fixtures, so this file runs against
    // two trees with different counts. Anything tuned to the bigger one fails
    // in the package, which is where it matters most.
    expect(entryPoints.length).toBeGreaterThanOrEqual(3);
  });

  it.each(entryPoints.map((e) => e.name))("pnpm %s loads the env", (name) => {
    const file = entryPoints.find((e) => e.name === name)!.file;
    expect(readFileSync(file, "utf8")).toContain("loadLocalEnv(");
  });
});
