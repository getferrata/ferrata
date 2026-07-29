import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLogger, rotate } from "@/lib/log";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ferrata-log-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The suite runs at `silent`; these tests are about the logger itself, so
  // they start from the default threshold and set their own where it matters.
  delete process.env.FERRATA_LOG_LEVEL;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.FERRATA_LOG_DIR;
  delete process.env.FERRATA_LOG_LEVEL;
  delete process.env.FERRATA_LOG_MAX_KB;
  delete process.env.FERRATA_LOG_KEEP;
  vi.restoreAllMocks();
});

describe("getLogger", () => {
  it("writes formatted lines to the file sink when FERRATA_LOG_DIR is set", () => {
    process.env.FERRATA_LOG_DIR = dir;
    getLogger("test").info("hello", { a: 1 });
    const body = readFileSync(join(dir, "ferrata.log"), "utf8");
    expect(body).toContain("INFO");
    expect(body).toContain("[test] hello");
    expect(body).toContain('{"a":1}');
  });

  it("respects the level threshold", () => {
    process.env.FERRATA_LOG_DIR = dir;
    process.env.FERRATA_LOG_LEVEL = "warn";
    const log = getLogger("test");
    log.debug("quiet");
    log.info("quiet too");
    log.warn("loud");
    const body = readFileSync(join(dir, "ferrata.log"), "utf8");
    expect(body).not.toContain("quiet");
    expect(body).toContain("loud");
  });

  it("stays console-only without FERRATA_LOG_DIR", () => {
    getLogger("test").info("nothing on disk");
    expect(existsSync(join(dir, "ferrata.log"))).toBe(false);
    expect(console.log).toHaveBeenCalledOnce();
  });

  it("rotates when the file exceeds the size cap and drops the oldest", () => {
    process.env.FERRATA_LOG_DIR = dir;
    process.env.FERRATA_LOG_MAX_KB = "1";
    process.env.FERRATA_LOG_KEEP = "2";
    const log = getLogger("test");
    const filler = "x".repeat(400);
    for (let i = 0; i < 12; i++) log.info(`${i} ${filler}`);
    expect(existsSync(join(dir, "ferrata.log"))).toBe(true);
    expect(existsSync(join(dir, "ferrata.log.1"))).toBe(true);
    expect(existsSync(join(dir, "ferrata.log.2"))).toBe(true);
    expect(existsSync(join(dir, "ferrata.log.3"))).toBe(false);
  });

  it("never throws when the sink is unwritable", () => {
    process.env.FERRATA_LOG_DIR = join(dir, "ferrata.log-not-a-dir");
    writeFileSync(process.env.FERRATA_LOG_DIR, "occupied");
    expect(() => getLogger("test").error("boom")).not.toThrow();
    expect(console.error).toHaveBeenCalledOnce();
  });
});

describe("rotate", () => {
  it("shifts files up and preserves contents", () => {
    writeFileSync(join(dir, "ferrata.log"), "current");
    writeFileSync(join(dir, "ferrata.log.1"), "older");
    rotate(dir, 3);
    expect(readFileSync(join(dir, "ferrata.log.1"), "utf8")).toBe("current");
    expect(readFileSync(join(dir, "ferrata.log.2"), "utf8")).toBe("older");
    expect(existsSync(join(dir, "ferrata.log"))).toBe(false);
  });
});
