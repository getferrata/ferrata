/**
 * Find out which SQLite operation aborts the process on this machine.
 *
 * Written for one bug and general enough to outlive it. On Windows the driver
 * can abort the whole process instead of throwing: Node fails an assertion,
 * `Assertion failed: (env) != nullptr`, and prints a native stack with no
 * JavaScript frame in it and no mention of SQLite or of the file. Nothing is
 * catchable and nothing says which line did it, so the only way to find out is
 * to do one thing at a time and see which line of output is the last.
 *
 * Run it directly rather than through the package manager:
 *
 *   node_modules/.bin/tsx scripts/db-probe.ts
 *
 * That matters. A process that aborts does not flush what it buffered, and a
 * package manager in the middle turns the console into a pipe, which buffers.
 * Run through pnpm, the probe can die several steps after the last line it
 * appears to have printed.
 *
 * Read the output as: the last STEP printed is the one that survived, and the
 * step after it is the one that killed the process.
 */
import Database from "better-sqlite3";
import { sql } from "drizzle-orm";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalEnv } from "@/lib/env";

/** Unbuffered, because the interesting runs end without a flush. */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  loadLocalEnv();
  say("");
  say("=== environment ===");
  say(`node          ${process.version}`);
  say(`platform      ${process.platform} ${process.arch}`);
  const pkg: { version?: string } = await import(
    "better-sqlite3/package.json",
    { with: { type: "json" } }
  ).then((m: { default: { version?: string } }) => m.default);
  say(`better-sqlite3 ${pkg.version ?? "unknown"}`);
  say("");

  const scratch = mkdtempSync(join(tmpdir(), "ferrata-probe-"));
  const probeFile = join(scratch, "probe.db");

  try {
    say("STEP 1  import the driver ....................... ok");

    // Everything below goes through the app's own module, because a probe that
    // opens its own connection would be testing a different program.
    const { db, sqlite, checkpoint } = await import("@/db");
    say("STEP 2  import the app database module .......... ok");

    db.all(sql.raw("select 1"));
    say("STEP 3  open the connection and query ........... ok");

    say(`        file: ${sqlite().name}`);

    checkpoint();
    say("STEP 4  wal checkpoint, what the worker does .... ok");

    // The step the backup used to perform. Removed from the product because it
    // was the first suspect; kept here because ruling it out is the point.
    const second = new Database(probeFile);
    second.prepare("create table t (a integer)").run();
    second.prepare("select count(*) as n from t").get();
    say("STEP 5  open a SECOND connection ................ ok");

    second.close();
    say("STEP 6  close the second connection ............. ok");

    // Statements from a closed connection become garbage here. If destroying
    // them is what aborts, this is where it happens rather than at close.
    global.gc?.();
    say("STEP 7  collect the garbage behind it ........... ok");

    await new Promise((r) => setTimeout(r, 8000));
    say("STEP 8  idle for eight seconds .................. ok");

    say("");
    say("SURVIVED: none of these steps aborts on this machine.");
    say("The trigger is somewhere else, most likely the interaction");
    say("with the server rather than the driver on its own.");
  } finally {
    if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  say("");
  say(`THREW (which is the good kind of failure): ${String(err)}`);
  process.exit(1);
});
