import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Nothing in the harness may be launched through a package manager shim.
 *
 * On Windows `pnpm` is `pnpm.cmd`, and current Node refuses to spawn a `.cmd`
 * without `shell: true`. The e2e launcher did exactly that, so the browser
 * suite could not start at all on the platform this product is most often
 * installed on: the seed exited non-zero, Playwright reported that its web
 * server would not come up, and none of the sixty-three tests ran.
 *
 * `shell: true` is the obvious repair and the wrong one for a long-lived
 * process: kill would reach cmd.exe and leave the server it wrapped holding
 * the port, so the next run fails on an address already in use and the cause
 * looks nothing like the fix. Spawning node against a tool's own entry point
 * avoids both, and stops the harness depending on what is on PATH.
 *
 * Read from the file rather than by running it, because running it is the
 * expensive thing this guards.
 */
const START = resolve(__dirname, "..", "e2e", "start.mjs");
const source = readFileSync(START, "utf8");

/** Command position only: an argument that merely says "next" is fine. */
const SPAWNED = /spawn(?:Sync)?\(\s*("[^"]*"|'[^']*'|[A-Za-z_.]+)/g;

describe("the e2e launcher spawns nothing through a shim", () => {
  it("spawns something, so a broken pattern cannot pass by matching nothing", () => {
    expect([...source.matchAll(SPAWNED)].length).toBeGreaterThanOrEqual(3);
  });

  it("names no package manager or bin shim as a command", () => {
    const commands = [...source.matchAll(SPAWNED)].map((m) => m[1] ?? "");
    for (const c of commands) {
      expect(c, `spawned command ${c}`).not.toMatch(/pnpm|npm|npx|yarn/);
    }
  });

  it("uses this node, so the child is the process and kill reaches it", () => {
    const commands = [...source.matchAll(SPAWNED)].map((m) => m[1] ?? "");
    expect(commands.every((c) => c === "process.execPath")).toBe(true);
  });

  it("does not reach for a shell to get around the problem", () => {
    // Comments stripped first: the file explains why a shell is the wrong
    // repair, and a check that cannot tell prose from code would forbid
    // saying so, which is how a comment ends up deleted to appease a test.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/shell:\s*true/);
  });

  it("points at entry points that are really there", () => {
    // A path that has moved with a dependency upgrade fails here, at no cost,
    // rather than eight minutes into a browser run.
    for (const rel of [
      ["node_modules", "tsx", "dist", "cli.mjs"],
      ["node_modules", "next", "dist", "bin", "next"],
    ]) {
      const full = resolve(__dirname, "..", ...rel);
      expect(existsSync(full), full).toBe(true);
    }
  });
});
