import { describe, expect, it } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "@/lib/auth/password";

/**
 * Restore, proven rather than assumed: separate processes, the commands an
 * operator would run, a database being written to while it is copied, and the
 * app's own code reading what comes back. The backup tests next door check that
 * a copy is taken and can be opened; none of them says that a person who loses
 * the machine gets their course back.
 */
const ROOT = resolve(__dirname, "..");
const tsx = join(ROOT, "node_modules/.bin/tsx");
const run = (args: string[], db: string) =>
  execFileSync(tsx, args, {
    cwd: ROOT,
    env: { ...process.env, FERRATA_DB_PATH: db },
    encoding: "utf8",
  });

describe("losing the machine and getting the course back", () => {
  it("a backup taken while the app is writing restores to a database the app can read", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ferrata-restore-"));
    const live = join(dir, "live.db");

    // A populated install: the demo course, plus an account that can sign in.
    run(["src/db/seed-demo.ts"], live);
    const seeded = new Database(live);
    seeded
      .prepare("insert into users (id, email, name, password_hash, role) values (?, ?, ?, ?, ?)")
      .run("user_restore", "restored@test.dev", "R", await hashPassword("correct horse battery"), "student");
    const before = {
      courses: (seeded.prepare("select count(*) n from courses").get() as { n: number }).n,
      modules: (seeded.prepare("select count(*) n from modules").get() as { n: number }).n,
      questions: (seeded.prepare("select count(*) n from questions").get() as { n: number }).n,
    };
    seeded.close();

    // Writes keep landing while the backup runs.
    const writer = spawn(tsx, ["tests/fixtures/write-loop.ts"], {
      cwd: ROOT,
      env: { ...process.env, FERRATA_DB_PATH: live },
    });
    const writerDone = new Promise<number>((res) => {
      let out = "";
      writer.stdout.on("data", (d) => (out += d));
      writer.on("close", () => res(Number(out.trim())));
    });
    // Until it has really written, not for a fixed time: a cold start of the
    // writer under load took longer than any number picked in advance.
    for (const start = Date.now(); ; ) {
      const probe = new Database(live, { readonly: true });
      const rows = (probe.prepare("select count(*) n from llm_calls").get() as { n: number }).n;
      probe.close();
      if (rows >= 100) break;
      if (Date.now() - start > 90_000) throw new Error("the writer never got going");
      await new Promise((r) => setTimeout(r, 250));
    }

    // Rows the writer has already committed. They live in the write-ahead log,
    // not yet in the main file, so a copy of the file alone silently lacks them:
    // the failure the backup command exists to avoid, and the one a restore of
    // the seeded rows alone would never notice.
    const peek = new Database(live, { readonly: true });
    const writtenBeforeBackup = (peek.prepare("select count(*) n from llm_calls").get() as { n: number }).n;
    peek.close();
    expect(writtenBeforeBackup).toBeGreaterThan(50);

    const copy = join(dir, "backups", "copy.db");
    run(["src/db/backup.ts", copy], live);
    expect(existsSync(copy)).toBe(true);
    expect(await writerDone).toBeGreaterThan(100); // it really was writing

    // The copy is internally consistent even though it was taken mid-write.
    const inspected = new Database(copy, { readonly: true });
    expect(inspected.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(inspected.pragma("foreign_key_check")).toEqual([]);
    inspected.close();

    // "Restore" is what DEPLOY says it is: put the file where the app looks.
    const restored = join(dir, "restored.db");
    copyFileSync(copy, restored);
    const after = JSON.parse(run(["tests/fixtures/read-restored.ts"], restored).trim().split("\n").pop()!);

    const reopened = new Database(restored, { readonly: true });
    const kept = (reopened.prepare("select count(*) n from llm_calls").get() as { n: number }).n;
    reopened.close();
    expect(kept).toBeGreaterThanOrEqual(writtenBeforeBackup);

    expect(after.courses).toBe(before.courses);
    expect(after.modules).toBe(before.modules);
    expect(after.questions).toBe(before.questions);
    expect(after.bundleModules).toBe(before.modules); // the app can assemble the course, not just count rows
    expect(after.loginWorks).toBe(true); // and the account still signs in
    expect(readdirSync(join(dir, "backups"))).toContain("copy.db");
  }, 180_000);
});

describe("the restore procedure written in DEPLOY.md", () => {
  // DEPLOY says to remove ferrata.db-wal and ferrata.db-shm before putting a
  // backup in place. Measured: copying the backup over ferrata.db and leaving
  // the old -wal beside it opens as a database that is NOT the backup, because
  // the stale log is replayed on top of it. This pins the reason for the step.
  const crashedLiveDatabase = (live: string) => {
    // A process that dies mid-run, leaving a log that was never checkpointed.
    spawnSync(
      process.execPath,
      [
        "-e",
        `const D = require("better-sqlite3");
         const d = new D(${JSON.stringify(live)});
         d.pragma("journal_mode=WAL"); d.pragma("wal_autocheckpoint=0");
         d.exec("create table a(id integer primary key, x blob)");
         for (let i = 0; i < 200; i++) d.prepare("insert into a(x) values (?)").run(Buffer.alloc(3000, i));
         process.kill(process.pid, "SIGKILL");`,
      ],
      { cwd: ROOT },
    );
  };
  const makeBackup = (path: string) => {
    const b = new Database(path);
    b.exec("create table t(id integer primary key, v text)");
    for (let i = 0; i < 100; i++) b.prepare("insert into t(v) values (?)").run(`backup-${i}`);
    b.close();
  };
  const readT = (path: string): number | string => {
    const d = new Database(path);
    try {
      return (d.prepare("select count(*) n from t").get() as { n: number }).n;
    } catch (e) {
      return (e as Error).message;
    } finally {
      d.close();
    }
  };

  it("restores the backup when the old log is removed first", () => {
    const dir = mkdtempSync(join(tmpdir(), "ferrata-stale-"));
    const live = join(dir, "ferrata.db");
    const backup = join(dir, "backup.db");
    makeBackup(backup);
    crashedLiveDatabase(live);
    expect(existsSync(`${live}-wal`)).toBe(true);

    for (const suffix of ["-wal", "-shm"]) rmSync(`${live}${suffix}`, { force: true });
    copyFileSync(backup, live);

    expect(readT(live)).toBe(100);
  });

  it("does not restore the backup when the old log is left in place", () => {
    const dir = mkdtempSync(join(tmpdir(), "ferrata-stale-"));
    const live = join(dir, "ferrata.db");
    const backup = join(dir, "backup.db");
    makeBackup(backup);
    crashedLiveDatabase(live);
    expect(existsSync(`${live}-wal`)).toBe(true);

    copyFileSync(backup, live); // only the main file, the obvious thing

    expect(readT(live)).not.toBe(100);
  });
});
