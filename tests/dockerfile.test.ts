import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Every path the Dockerfile copies out of the build context has to exist.
 *
 * This is here because it happened: a release removed a directory that nothing
 * in the app referenced any more, correctly, and the Dockerfile still copied
 * it. Every check that ran on the package passed, because install, typecheck,
 * tests and build never look at the Dockerfile. The container build failed on
 * its third instruction, after the tag was already public.
 *
 * The build itself needs a daemon and does not belong in a unit suite. This
 * catches the one failure mode that a unit suite can catch, which is the one
 * that occurred.
 */

const ROOT = resolve(__dirname, "..");
const DOCKERFILE = readFileSync(resolve(ROOT, "Dockerfile"), "utf8");

/** COPY sources that come from the build context, not from an earlier stage. */
function contextCopySources(): string[] {
  const out: string[] = [];
  for (const raw of DOCKERFILE.split("\n")) {
    const line = raw.trim();
    if (!/^COPY\s/i.test(line) || /--from=/i.test(line)) continue;
    // Drop the instruction and the destination; what is left is the sources.
    const args = line
      .replace(/^COPY\s+/i, "")
      .split(/\s+/)
      .filter((a) => !a.startsWith("--"));
    out.push(...args.slice(0, -1));
  }
  return out;
}

describe("the Dockerfile against the tree it builds from", () => {
  it("copies only paths that exist", () => {
    for (const src of contextCopySources()) {
      // "." is the whole context and always resolves.
      if (src === "." || src.includes("*")) continue;
      expect(existsSync(resolve(ROOT, src)), `Dockerfile copies ${src}`).toBe(
        true,
      );
    }
  });

  it("is actually reading COPY lines, so a pass means something", () => {
    // Without this, deleting every COPY would make the test above pass.
    expect(contextCopySources().length).toBeGreaterThan(0);
  });

  it("copies a patches directory only when a dependency is patched", () => {
    // The two have to move together. A patch in package.json that never
    // reaches the image produces a container that is quietly not the app.
    const pkg = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ) as { pnpm?: { patchedDependencies?: Record<string, string> } };
    const patched = Object.keys(pkg.pnpm?.patchedDependencies ?? {}).length > 0;
    const copiesPatches = /^COPY\s+patches\b/im.test(DOCKERFILE);
    expect(copiesPatches).toBe(patched);
  });
});
