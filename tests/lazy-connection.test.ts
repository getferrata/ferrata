import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Importing the database module must not open a database.
 *
 * This is the one invariant in the repo that cannot be tested in process, and
 * the reason it needs testing at all is that it was broken and shipped. `db`
 * used to be a connection built at module scope, which meant that anything
 * importing it opened a file handle whether or not it ever ran a query.
 * `next build` collects page data by importing every page in parallel workers,
 * each of them a separate V8 environment in one process, and better-sqlite3
 * registers a cleanup hook per environment. On Windows the teardown aborted the
 * process: `Assertion failed: (env) != nullptr`, exit 134, in a native stack
 * with no JavaScript frame in it and nothing naming the database. Ferrata could
 * not be built on Windows at all, and nothing in a green suite said so.
 *
 * Nothing already loaded can observe this, since by then the module has been
 * imported and whatever it was going to do it has done. So each case is a fresh
 * process pointed at a database path that does not exist yet, and the question
 * asked is the plain one: is the file there afterwards.
 */

const ROOT = resolve(__dirname, "..");
/**
 * This node, run against tsx's own entry point. Not the shim in `.bin`.
 *
 * The shim was tried twice and is wrong both ways. `tsx` is a shell script, so
 * Windows cannot spawn it: ENOENT. `tsx.cmd` is what Windows would use, but
 * current Node refuses to spawn a `.cmd` at all without `shell: true`: EINVAL.
 * The entry point is a plain module and needs neither, which is also what the
 * e2e launcher does, for the same reason.
 */
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
/**
 * A file:// URL, not a path.
 *
 * These snippets reach the module through a dynamic `import()`, whose argument
 * is a URL. On Linux an absolute path happens to work because it looks like a
 * root-relative one; on Windows `C:\\...` parses as a URL with the scheme `c:`,
 * and the loader refuses it: ERR_UNSUPPORTED_ESM_URL_SCHEME. The specifier has
 * to be built rather than assumed, and pathToFileURL is what builds it.
 */
const DB_MODULE = pathToFileURL(join(ROOT, "src", "db", "index.ts")).href;

/**
 * Run a snippet in a fresh process against a database path of our choosing.
 *
 * Wrapped in an async IIFE because `tsx -e` compiles to CommonJS, where a
 * top-level await is a syntax error rather than a slow import.
 */
function inFreshProcess(snippet: string, dbPath: string): void {
  const program = `(async () => { ${snippet} })().catch((err) => {
    console.error(err);
    process.exit(1);
  });`;
  execFileSync(process.execPath, [TSX, "-e", program], {
    cwd: ROOT,
    env: { ...process.env, FERRATA_DB_PATH: dbPath, FERRATA_LOG_LEVEL: "silent" },
    stdio: "pipe",
    timeout: 60_000,
  });
}

function withTempDbPath(run: (dbPath: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "ferrata-lazy-"));
  try {
    run(join(dir, "probe.db"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("the connection opens on use, not on import", () => {
  it("leaves no database behind when the module is only imported", () => {
    withTempDbPath((dbPath) => {
      inFreshProcess(`await import(${JSON.stringify(DB_MODULE)});`, dbPath);
      expect(
        existsSync(dbPath),
        "importing @/db created a database file, so every page-data worker in a build opens one",
      ).toBe(false);
    });
  });

  it("still opens on the first real use, which is the half that matters", () => {
    // Without this the test above passes for the wrong reason: a module that
    // exports nothing usable would satisfy it perfectly.
    withTempDbPath((dbPath) => {
      inFreshProcess(
        `const { db } = await import(${JSON.stringify(DB_MODULE)});
         const { sql } = await import("drizzle-orm");
         db.all(sql.raw("SELECT 1"));`,
        dbPath,
      );
      expect(existsSync(dbPath)).toBe(true);
    });
  });

  it("opens for the backup, which asks for the handle before any query runs", () => {
    withTempDbPath((dbPath) => {
      inFreshProcess(
        `const { sqlite } = await import(${JSON.stringify(DB_MODULE)});
         if (!sqlite().open) throw new Error("connection is not open");`,
        dbPath,
      );
      expect(existsSync(dbPath)).toBe(true);
    });
  });
});
