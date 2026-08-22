import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { walkRepo, repoPathAllowed, allowedRepoRoots } from "@/lib/sources/repo";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "ferrata-repo-"));
  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "src-other"), { recursive: true });
  await mkdir(join(root, "node_modules", "dep"), { recursive: true });
  await mkdir(join(root, "docs"), { recursive: true });
  await writeFile(join(root, "src", "index.ts"), "export const x = 1;\n");
  await writeFile(join(root, "docs", "guide.md"), "# Guide\ncontent\n");
  await writeFile(join(root, "README.md"), "# Project\n");
  await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}');
  await writeFile(join(root, "node_modules", "dep", "a.js"), "module.exports={}");
  await writeFile(join(root, "logo.png"), Buffer.from([0, 1, 2, 3, 0, 255]));
  await writeFile(join(root, "big.txt"), "x".repeat(300 * 1024)); // >200KB
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("walkRepo", () => {
  it("keeps source/doc files and drops junk, lockfiles, binaries, huge files", async () => {
    const items = await walkRepo(root);
    const rels = items.map((i) => i.rel);
    expect(rels).toContain("src/index.ts");
    expect(rels).toContain("docs/guide.md");
    expect(rels).toContain("README.md");
    // excluded
    expect(rels.some((r) => r.startsWith("node_modules/"))).toBe(false);
    expect(rels).not.toContain("package-lock.json");
    expect(rels).not.toContain("logo.png");
    expect(rels).not.toContain("big.txt");
  });

  it("orders docs/README before other files", async () => {
    const items = await walkRepo(root);
    const firstCode = items.findIndex((i) => i.rel === "src/index.ts");
    const readme = items.findIndex((i) => i.rel === "README.md");
    expect(readme).toBeLessThan(firstCode);
  });
});

describe("repoPathAllowed (local-file-disclosure guard)", () => {
  const prev = process.env.FERRATA_REPO_ROOTS;
  afterAll(() => {
    if (prev === undefined) delete process.env.FERRATA_REPO_ROOTS;
    else process.env.FERRATA_REPO_ROOTS = prev;
  });

  it("denies everything when no roots are configured (safe by default)", async () => {
    delete process.env.FERRATA_REPO_ROOTS;
    expect(await repoPathAllowed(root)).toBe(false);
    expect(await repoPathAllowed(join(root, "src"))).toBe(false);
  });

  it("allows a path inside an allowlisted root, denies one outside it", async () => {
    process.env.FERRATA_REPO_ROOTS = root;
    expect(await repoPathAllowed(root)).toBe(true);
    expect(await repoPathAllowed(join(root, "src"))).toBe(true);
    expect(await repoPathAllowed(tmpdir())).toBe(false);
    expect(await repoPathAllowed("/etc")).toBe(false);
  });

  it("is not fooled by a sibling dir sharing the root's name prefix", async () => {
    process.env.FERRATA_REPO_ROOTS = join(root, "src");
    // "<root>/src-evil" must NOT match the "<root>/src" root.
    await mkdir(join(root, "src-evil"), { recursive: true });
    expect(await repoPathAllowed(join(root, "src-evil"))).toBe(false);
    expect(await repoPathAllowed(join(root, "src"))).toBe(true);
  });
});

/**
 * The allowlisted root gets canonicalised too, not just the path being checked.
 *
 * This is the Windows bug in a form Linux can see. There, realpath expands 8.3
 * short names and returns the casing the filesystem holds, so a root the
 * operator set never equalled the canonical path of anything under it and the
 * guard denied the whole machine. The same asymmetry shows up here through a
 * symlink: the candidate went through realpath and the root did not, so the
 * two were compared in different spellings of the same directory.
 *
 * It failed closed, which is why nothing leaked and why nobody noticed:
 * repository ingestion simply never worked on Windows.
 */
describe("a root reached through a symlink is still that root", () => {
  const prev = process.env.FERRATA_REPO_ROOTS;
  let real = "";
  let link = "";

  beforeAll(async () => {
    const base = await mkdtemp(join(tmpdir(), "ferrata-link-"));
    real = join(base, "real-root");
    link = join(base, "link-root");
    await mkdir(join(real, "src"), { recursive: true });
    await mkdir(join(base, "real-root-evil"), { recursive: true });
    await symlink(real, link, "dir");
  });

  afterAll(async () => {
    if (prev === undefined) delete process.env.FERRATA_REPO_ROOTS;
    else process.env.FERRATA_REPO_ROOTS = prev;
    if (link) await rm(join(link, ".."), { recursive: true, force: true });
  });

  it("allows what is inside it, named through the link", async () => {
    process.env.FERRATA_REPO_ROOTS = link;
    expect(await repoPathAllowed(link)).toBe(true);
    expect(await repoPathAllowed(join(link, "src"))).toBe(true);
  });

  it("allows the same directory named directly", async () => {
    process.env.FERRATA_REPO_ROOTS = link;
    expect(await repoPathAllowed(real)).toBe(true);
    expect(await repoPathAllowed(join(real, "src"))).toBe(true);
  });

  it("still refuses a sibling whose name starts with the root's", async () => {
    // The separator is doing the work. Without it, canonicalising both sides
    // would have widened the guard rather than fixed it.
    process.env.FERRATA_REPO_ROOTS = link;
    expect(await repoPathAllowed(join(real, "..", "real-root-evil"))).toBe(false);
  });

  it("allows nothing when the configured root does not exist", async () => {
    process.env.FERRATA_REPO_ROOTS = join(real, "..", "not-a-directory");
    expect(await repoPathAllowed(real)).toBe(false);
  });
});

describe("repository ingestion is off until an operator turns it on", () => {
  it("allows nothing when no roots are configured", async () => {
    // The default on every fresh install. Before this was surfaced, a path
    // typed here was dropped in silence and the author got a course built
    // from nothing, with no idea why.
    delete process.env.FERRATA_REPO_ROOTS;
    expect(allowedRepoRoots()).toEqual([]);
    expect(await repoPathAllowed(root)).toBe(false);
  });

  it("allows a path inside a configured root", async () => {
    process.env.FERRATA_REPO_ROOTS = root;
    expect(await repoPathAllowed(root)).toBe(true);
    expect(await repoPathAllowed(join(root, "src"))).toBe(true);
  });

  it("refuses a sibling that merely shares a prefix", async () => {
    process.env.FERRATA_REPO_ROOTS = join(root, "src");
    expect(await repoPathAllowed(join(root, "src-other"))).toBe(false);
  });

  it("refuses a path that does not exist", async () => {
    process.env.FERRATA_REPO_ROOTS = root;
    expect(await repoPathAllowed(join(root, "nope"))).toBe(false);
  });
});
