import { readdir, readFile, stat, realpath } from "node:fs/promises";
import { join, relative, sep, extname, basename, resolve } from "node:path";
import { ingestSource } from "./ingest";
import type { ContextiaMode } from "./dlp";

/**
 * Absolute base directories under which repo ingestion is permitted, set by the
 * operator via FERRATA_REPO_ROOTS (comma-separated). With NONE configured, repo
 * ingestion is OFF, safe by default for a hosted/multi-user beta, where an
 * absolute `repoPath` from an authenticated user would otherwise be a
 * local-file-disclosure vector (read /etc, another tenant's files, secrets on
 * the box). The sovereign single-operator opts in by naming their code roots.
 */
export function allowedRepoRoots(): string[] {
  return (process.env.FERRATA_REPO_ROOTS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Two paths that name the same directory, on a filesystem that says so.
 *
 * Windows and macOS both match filenames without regard to case, so a root the
 * operator typed as `C:\Code` and a path the OS reports as `C:\code` are one
 * directory, and treating them as two denies the operator their own machine.
 * Linux is case sensitive and gets an exact comparison, because there those
 * really are two directories.
 */
const CASE_INSENSITIVE_FS =
  process.platform === "win32" || process.platform === "darwin";

function fold(p: string): string {
  return CASE_INSENSITIVE_FS ? p.toLowerCase() : p;
}

/**
 * The canonical form of a path: absolute, symlinks followed, short names
 * expanded. Null when it does not exist, which denies rather than guesses.
 */
async function canonical(p: string): Promise<string | null> {
  try {
    return await realpath(resolve(p));
  } catch {
    return null;
  }
}

/**
 * True only if `rootDir` resolves (following symlinks) to inside an allowlisted
 * root. realpath collapses `..` and symlink escapes before the prefix check.
 *
 * Both sides go through realpath, which is the half that was missing. The
 * candidate was canonicalised and the root was only resolved, so on Windows
 * they could never match: realpath there expands 8.3 short names and returns
 * the casing the filesystem actually holds, so a root under a temp directory
 * came back as something spelled differently from what the operator set. The
 * guard then denied every path on the machine. It failed closed, so nothing
 * leaked; repository ingestion simply did not work on Windows at all.
 */
export async function repoPathAllowed(rootDir: string): Promise<boolean> {
  const roots = allowedRepoRoots();
  if (roots.length === 0) return false;
  const real = await canonical(rootDir);
  if (real === null) return false;

  for (const base of roots) {
    const b = await canonical(base);
    // A root that does not exist allows nothing. Silently, because an operator
    // typo must not turn into a wider allowlist than the one they wrote.
    if (b === null) continue;
    if (fold(real) === fold(b)) return true;
    // The separator is what stops `<root>/src` from matching `<root>/src-evil`.
    const prefix = b.endsWith(sep) ? b : b + sep;
    if (fold(real).startsWith(fold(prefix))) return true;
  }
  return false;
}

/**
 * Ingest a local code repository as course material: this is what turns
 * "study this topic" into "study OUR codebase". Sovereign, in that it
 * reads a directory already on the machine, so nothing is cloned or uploaded.
 * Each kept file becomes a source named by its path (so modules cite
 * `[fonte: src/foo.ts]`) and passes the Contextia DLP gate like any other source.
 */

// Directories that are never useful and would blow the budget.
const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "out", "target", "vendor",
  "__pycache__", ".venv", "venv", "coverage", ".cache", ".turbo", ".gradle",
  "bin", "obj", ".idea", ".vscode", ".svn", "Pods", ".terraform", "tmp",
]);

// Files we skip by exact name (lockfiles, minified, maps).
const SKIP_FILES = new Set([
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
  "Cargo.lock", "poetry.lock", "composer.lock", "Gemfile.lock", "go.sum",
]);

// Text/code extensions worth grounding on. Extensionless config names below.
const KEEP_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".h", ".hpp", ".cpp", ".cc", ".cs", ".kt", ".swift",
  ".scala", ".ex", ".exs", ".clj", ".erl", ".hs", ".lua", ".r", ".m",
  ".md", ".mdx", ".rst", ".txt", ".adoc",
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env", ".properties",
  ".sql", ".graphql", ".proto", ".sh", ".bash", ".zsh", ".ps1",
  ".html", ".css", ".scss", ".sass", ".less", ".vue", ".svelte",
  ".tf", ".hcl", ".gradle", ".xml", ".csv",
]);
const KEEP_NAMES = new Set([
  "Dockerfile", "Makefile", "Justfile", "Procfile", "README", "LICENSE",
  ".env.example", ".gitignore",
]);

const MAX_FILE_BYTES = 200 * 1024; // skip huge/generated files
const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_TOTAL_BYTES = 4 * 1024 * 1024; // total grounding budget

export interface RepoWalkItem {
  abs: string;
  rel: string;
  bytes: number;
}

function keepFile(name: string): boolean {
  if (SKIP_FILES.has(name)) return false;
  if (name.endsWith(".min.js") || name.endsWith(".map")) return false;
  if (KEEP_NAMES.has(name)) return true;
  return KEEP_EXT.has(extname(name).toLowerCase());
}

/** Recursively collect candidate files, filtered and depth-bounded. */
export async function walkRepo(
  rootDir: string,
  maxDepth = 12,
): Promise<RepoWalkItem[]> {
  const out: RepoWalkItem[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // Never follow symlinks: a repo could point one outside its own tree.
      if (e.isSymbolicLink()) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(abs, depth + 1);
      } else if (e.isFile() && keepFile(e.name)) {
        let bytes;
        try {
          bytes = (await stat(abs)).size;
        } catch {
          continue;
        }
        if (bytes === 0 || bytes > MAX_FILE_BYTES) continue;
        out.push({ abs, rel: relative(rootDir, abs).split(sep).join("/"), bytes });
      }
    }
  }
  await walk(rootDir, 0);
  // Stable, sensible order: docs first, then by path.
  return out.sort((a, b) => {
    const ad = /readme|docs?\//i.test(a.rel) ? 0 : 1;
    const bd = /readme|docs?\//i.test(b.rel) ? 0 : 1;
    return ad - bd || a.rel.localeCompare(b.rel);
  });
}

/** A file's bytes read as text, or null if it looks binary. */
async function readTextFile(abs: string): Promise<string | null> {
  const buf = await readFile(abs);
  // Heuristic: a NUL byte in the first 8 KB means binary.
  const probe = buf.subarray(0, 8192);
  if (probe.includes(0)) return null;
  return buf.toString("utf8");
}

export interface RepoIngestResult {
  candidates: number;
  ingested: number;
  skipped: number;
  truncated: boolean;
}

export async function ingestRepo(
  courseId: string,
  rootDir: string,
  opts: { maxFiles?: number; maxTotalBytes?: number; contextiaMode?: ContextiaMode } = {},
): Promise<RepoIngestResult> {
  const maxFiles = opts.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const candidates = await walkRepo(rootDir);

  let ingested = 0;
  let skipped = 0;
  let total = 0;
  let truncated = false;

  for (const f of candidates) {
    if (ingested >= maxFiles || total + f.bytes > maxTotalBytes) {
      truncated = true;
      break;
    }
    let text: string | null;
    try {
      text = await readTextFile(f.abs);
    } catch {
      skipped++;
      continue;
    }
    if (text === null || text.trim().length === 0) {
      skipped++;
      continue;
    }
    const res = await ingestSource(
      courseId,
      { kind: "text", name: f.rel || basename(f.abs), text },
      opts.contextiaMode,
    );
    if (res.ok) {
      ingested++;
      total += f.bytes;
    } else {
      skipped++;
    }
  }

  return { candidates: candidates.length, ingested, skipped, truncated };
}
