import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What a copy of the database file actually contains.
 *
 * This is here because it cost a real course. The app runs SQLite in WAL mode,
 * so writes land in `ferrata.db-wal` and only reach `ferrata.db` at a
 * checkpoint. A backup taken by copying the one file is therefore a database as
 * of the last checkpoint, which opens cleanly, restores cleanly, and is missing
 * whatever came after. Nothing anywhere fails.
 */

function scratch(): string {
  return join(mkdtempSync(join(tmpdir(), "ferrata-wal-")), "test.db");
}

function open(path: string): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec("create table if not exists t (id integer primary key, v text)");
  return db;
}

describe("copying a database while it is being written", () => {
  it("loses the recent writes without the checkpoint", () => {
    const path = scratch();
    const db = open(path);
    db.prepare("insert into t (v) values (?)").run("before");
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.prepare("insert into t (v) values (?)").run("after");

    // The WAL now holds a row the main file does not.
    expect(existsSync(`${path}-wal`)).toBe(true);
    expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);

    const copy = join(mkdtempSync(join(tmpdir(), "ferrata-copy-")), "copy.db");
    // Deliberately the naive backup: the main file and nothing else.
    require("node:fs").copyFileSync(path, copy);
    const read = new Database(copy, { readonly: true });
    expect(read.prepare("select count(*) as n from t").get()).toEqual({ n: 1 });
    read.close();
    db.close();
  });

  it("keeps them once the write-ahead log has been folded back in", () => {
    const path = scratch();
    const db = open(path);
    db.prepare("insert into t (v) values (?)").run("before");
    db.prepare("insert into t (v) values (?)").run("after");
    // What the worker does when it runs out of work.
    db.pragma("wal_checkpoint(TRUNCATE)");

    const copy = join(mkdtempSync(join(tmpdir(), "ferrata-copy-")), "copy.db");
    require("node:fs").copyFileSync(path, copy);
    const read = new Database(copy, { readonly: true });
    expect(read.prepare("select count(*) as n from t").get()).toEqual({ n: 2 });
    read.close();
    db.close();
  });

  it("keeps them all through the backup API, checkpoint or not", async () => {
    // The correct way, and the one pnpm db:backup uses: consistent across the
    // main file and the log, with the writer still running.
    const path = scratch();
    const db = open(path);
    db.prepare("insert into t (v) values (?)").run("before");
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.prepare("insert into t (v) values (?)").run("after");

    const copy = join(mkdtempSync(join(tmpdir(), "ferrata-copy-")), "copy.db");
    await db.backup(copy);
    const read = new Database(copy, { readonly: true });
    expect(read.prepare("select count(*) as n from t").get()).toEqual({ n: 2 });
    read.close();
    db.close();
  });
});
