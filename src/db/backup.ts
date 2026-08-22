/**
 * Safe database copy: `pnpm db:backup [destination]`.
 *
 * This exists because the obvious thing is wrong. The database runs in WAL
 * mode, so on disk it is three files: `ferrata.db` holds what has been
 * checkpointed, `ferrata.db-wal` holds everything written since, and
 * `ferrata.db-shm` is the shared index into it. Copying `ferrata.db` alone
 * while the app is running silently produces a database rolled back to the
 * last checkpoint, which looks like a valid backup and is not one. It costs
 * nothing to notice on a quiet install and everything on a busy one.
 *
 * SQLite's own backup API reads a consistent snapshot across all three, with
 * the app still running and writing. It is the only correct way to do this
 * short of stopping the process, and it needs no sqlite3 binary installed.
 */
import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { loadLocalEnv } from "../lib/env";

// Without this the backup copies whichever database the default path names,
// which on an install that sets FERRATA_DB_PATH is not the one in use.
loadLocalEnv();

const source = process.env.FERRATA_DB_PATH ?? "./ferrata.db";
if (!existsSync(source)) {
  console.error(`No database at ${resolve(source)}`);
  process.exit(1);
}

// Default name carries the date, so a nightly cron does not overwrite
// yesterday's copy with today's and leave one backup where there were seven.
const stamp = new Date().toISOString().slice(0, 10);
const destination = process.argv[2] ?? `./backups/ferrata-${stamp}.db`;
mkdirSync(dirname(resolve(destination)), { recursive: true });

const db = new Database(source, { readonly: true, fileMustExist: true });

db.backup(destination)
  .then(() => {
    // Reopen the copy and count what is in it. A backup nobody has read is a
    // belief, not a backup, and this is the cheapest possible check.
    const copy = new Database(destination, { readonly: true });
    const courses = copy
      .prepare("select count(*) as n from courses")
      .get() as { n: number };
    const modules = copy
      .prepare("select count(*) as n from modules")
      .get() as { n: number };
    copy.close();
     
    console.log(
      `Backed up to ${resolve(destination)}: ${courses.n} courses, ${modules.n} modules.`,
    );
    db.close();
  })
  .catch((err: unknown) => {
    console.error(`Backup failed: ${err instanceof Error ? err.message : err}`);
    db.close();
    process.exit(1);
  });
