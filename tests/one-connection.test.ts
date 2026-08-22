import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Inside the server there is one SQLite connection and one place that opens it.
 *
 * The rule is not tidiness. Opening the native module registers a cleanup hook
 * per environment, and closing a connection tears down the statement objects
 * behind it. When that teardown coincides with an environment going away, Node
 * fails an assertion instead of throwing, and a failed assertion is not an
 * error somebody can catch: the process aborts with exit 134 and prints a
 * native stack with no JavaScript in it. It says nothing about SQLite, nothing
 * about the file, and nothing about which line did it.
 *
 * That is what the scheduled backup did. It copied the database, then opened
 * the copy through a second connection to count its rows, then closed it, and
 * the server died about a second after reporting it was ready. On Linux the
 * same code is fine, which is why every check here was green while Ferrata was
 * unusable on Windows. It reads the copy through ATTACH now, on the connection
 * that is already open.
 *
 * So: application code does not construct connections. The two standalone
 * scripts may, because each is its own short-lived process with one
 * environment in it and nothing else running alongside.
 */

const SRC = resolve(__dirname, "..", "src");

/** Own their own process: `pnpm db:migrate` and `pnpm db:backup`. */
const STANDALONE_SCRIPTS = ["db/backup.ts", "db/migrate.ts"];

/** The single owner of the server's connection. */
const OWNER = "db/index.ts";

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.tsx?$/.test(name)) found.push(full);
  }
  return found;
}

describe("one connection, one owner", () => {
  const files = sources(SRC);

  it("finds the source tree, so the checks below are looking at something", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("nothing but the owner and the standalone scripts opens a connection", () => {
    const allowed = new Set([OWNER, ...STANDALONE_SCRIPTS]);
    const offenders = files
      .filter((f) => /new Database\(/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => !allowed.has(rel));

    expect(
      offenders,
      "a second connection inside the server aborts the process on Windows when it closes",
    ).toEqual([]);
  });

  it("nothing but the owner and the standalone scripts even loads the driver", () => {
    // Weaker than the check above and worth having separately: importing the
    // native module is what registers the cleanup hook, so a file that imports
    // it without opening anything still puts the addon into whatever
    // environment loaded that file.
    const allowed = new Set([OWNER, ...STANDALONE_SCRIPTS]);
    const offenders = files
      .filter((f) => /from "better-sqlite3"/.test(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).split("\\").join("/"))
      .filter((rel) => !allowed.has(rel));

    // Type-only imports are not loads and would be fine, but none exist today
    // and allowing them here would mean parsing rather than matching.
    expect(offenders).toEqual([]);
  });

  it("the backup reads its copy through the connection already open", () => {
    const body = readFileSync(join(SRC, "lib", "backup", "index.ts"), "utf8");
    expect(body).toMatch(/ATTACH DATABASE/);
    expect(body).toMatch(/DETACH DATABASE/);
    expect(body).not.toMatch(/new Database\(/);
  });
});
