import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = mkdtempSync(join(tmpdir(), "ferrata-bk-"));
process.env.FERRATA_DB_PATH = join(ROOT, "test.db");

const { db } = await import("@/db");
const { courses } = await import("@/db/schema");
const { newId } = await import("@/lib/util/id");
const {
  backupConfig,
  backupIsDue,
  listBackups,
  prune,
  refusedReason,
  runBackup,
  secondsSinceLastBackup,
} = await import("@/lib/backup");

/** A backup directory of its own per test, so pruning cannot cross over. */
function dir(): string {
  return mkdtempSync(join(ROOT, "out-"));
}

function seedCourse(title: string): void {
  db.insert(courses)
    .values({
      id: newId("course"),
      title,
      sourcePrompt: "p",
      lang: "en",
      status: "ready",
    })
    .run();
}

/** Backdate a file, to stand in for time passing. */
function age(file: string, hours: number): void {
  const when = new Date(Date.now() - hours * 3600 * 1000);
  utimesSync(file, when, when);
}

const ENV = { ...process.env };

beforeEach(() => {
  db.delete(courses).run();
});

afterEach(() => {
  process.env = { ...ENV };
});

describe("taking a backup", () => {
  it("copies a database that can be opened and read back", async () => {
    seedCourse("Edge onboarding");
    const out = dir();
    const record = await runBackup({ dir: out, everyHours: 24, keep: 7 });

    expect(existsSync(record.file)).toBe(true);
    const copy = new Database(record.file, { readonly: true });
    const n = copy.prepare("select count(*) as n from courses").get() as {
      n: number;
    };
    copy.close();
    expect(n.n).toBe(1);
  });

  it("reads the copy back itself, and says what it found", async () => {
    // The whole point. A copy nobody has opened is a belief: the failure being
    // defended against is one where the file exists and is short.
    seedCourse("One");
    seedCourse("Two");
    const record = await runBackup({ dir: dir(), everyHours: 24, keep: 7 });
    expect(record.verified).toEqual({ courses: 2, modules: 0, questions: 0 });
  });

  it("carries the whole database, not the database as of the last checkpoint", async () => {
    // The defect that cost a real course: in WAL mode a plain file copy is
    // rolled back to the last checkpoint, opens cleanly, and is missing the
    // recent writes. SQLite's backup API is the fix, and this is the assertion
    // that a plain copy would fail.
    seedCourse("Written after the last checkpoint");
    const record = await runBackup({ dir: dir(), everyHours: 24, keep: 7 });
    expect(record.verified?.courses).toBe(1);
  });

  it("does not overwrite a backup taken in the same second", async () => {
    // An operator pressing "back up now" twice before an upgrade. The stamp
    // goes to the second, so back to back these collide, and writing over the
    // first would leave one copy where the panel shows two: the exact failure
    // this whole file exists to prevent, reintroduced by the fix for it.
    const out = dir();
    seedCourse("One");
    await Promise.all([
      runBackup({ dir: out, everyHours: 24, keep: 7 }),
      runBackup({ dir: out, everyHours: 24, keep: 7 }),
      runBackup({ dir: out, everyHours: 24, keep: 7 }),
    ]);
    expect(readdirSync(out).filter((f) => f.endsWith(".db"))).toHaveLength(3);
  });

  it("refuses when there is no database to copy", async () => {
    process.env.FERRATA_DB_PATH = join(ROOT, "not-here.db");
    await expect(
      runBackup({ dir: dir(), everyHours: 24, keep: 7 }),
    ).rejects.toThrow(/no database/);
    process.env.FERRATA_DB_PATH = join(ROOT, "test.db");
  });
});

describe("where the copies are allowed to go", () => {
  it("refuses a directory inside public/, which is served", () => {
    // The database holds every password hash and the provider key. A backup
    // under public/ is those, downloadable by anyone who guesses a filename.
    // Refused rather than warned about: no operator means that.
    const inside = join(process.cwd(), "public", "backups");
    expect(refusedReason(inside)).toMatch(/downloadable/);
  });

  it("refuses public/ itself", () => {
    expect(refusedReason(join(process.cwd(), "public"))).toMatch(/downloadable/);
  });

  it("allows a directory whose name merely starts with public", () => {
    // A prefix match on the string would refuse this, and refusing a legitimate
    // path is how an operator ends up with no backups at all.
    expect(refusedReason(join(process.cwd(), "public-backups"))).toBeNull();
  });

  it("allows the default, next to the database", () => {
    expect(refusedReason(backupConfig().dir)).toBeNull();
  });

  it("will not run at all into a refused directory", async () => {
    await expect(
      runBackup({
        dir: join(process.cwd(), "public", "backups"),
        everyHours: 24,
        keep: 7,
      }),
    ).rejects.toThrow(/downloadable/);
  });
});

describe("deciding when the next one is due", () => {
  it("is due when there has never been one", () => {
    expect(backupIsDue({ dir: dir(), everyHours: 24, keep: 7 })).toBe(true);
  });

  it("is not due right after one was taken", async () => {
    const out = dir();
    await runBackup({ dir: out, everyHours: 24, keep: 7 });
    expect(backupIsDue({ dir: out, everyHours: 24, keep: 7 })).toBe(false);
  });

  it("is due again once the interval has passed", async () => {
    const out = dir();
    const record = await runBackup({ dir: out, everyHours: 24, keep: 7 });
    age(record.file, 25);
    expect(backupIsDue({ dir: out, everyHours: 24, keep: 7 })).toBe(true);
  });

  it("is never due when the schedule is switched off", () => {
    // An operator with their own snapshots underneath. Zero has to mean off
    // and not "every zero hours", which would copy the database every second.
    expect(backupIsDue({ dir: dir(), everyHours: 0, keep: 7 })).toBe(false);
  });

  it("reports the age of the newest copy, not of any copy", async () => {
    const out = dir();
    const old = await runBackup({ dir: out, everyHours: 24, keep: 7 });
    age(old.file, 100);
    await runBackup({ dir: out, everyHours: 24, keep: 7 });
    expect(secondsSinceLastBackup(out)).toBeLessThan(60);
  });
});

describe("keeping a handful and no more", () => {
  it("deletes the oldest past the limit, manifest and all", async () => {
    const out = dir();
    for (let i = 0; i < 4; i++) {
      const r = await runBackup({ dir: out, everyHours: 24, keep: 10 });
      age(r.file, 100 - i);
    }
    expect(listBackups(out)).toHaveLength(4);

    expect(prune({ dir: out, everyHours: 24, keep: 2 })).toBe(2);
    const left = listBackups(out);
    expect(left).toHaveLength(2);
    // The two newest survive, and no orphaned manifests are left behind.
    expect(readdirSync(out).filter((f) => f.endsWith(".json"))).toHaveLength(2);
  });

  it("never prunes down to nothing, whatever the setting says", () => {
    // A misread environment variable must not be able to delete every backup.
    process.env.FERRATA_BACKUP_KEEP = "0";
    expect(backupConfig().keep).toBe(1);
  });

  it("prunes as part of taking one, not on a separate schedule nobody runs", async () => {
    const out = dir();
    for (let i = 0; i < 3; i++) {
      const r = await runBackup({ dir: out, everyHours: 24, keep: 2 });
      age(r.file, 10 - i);
    }
    expect(listBackups(out)).toHaveLength(2);
  });
});

describe("reading the directory", () => {
  it("is empty rather than an error when nothing is there yet", () => {
    expect(listBackups(join(ROOT, "never-created"))).toEqual([]);
    expect(secondsSinceLastBackup(join(ROOT, "never-created"))).toBeNull();
  });

  it("lists a file somebody put there by hand, and marks it unverified", () => {
    // Honest rather than tidy: hiding it would let an operator believe the
    // directory is empty when a stale copy is sitting in it.
    const out = dir();
    writeFileSync(join(out, "ferrata-by-hand.db"), "not really a database");
    const [entry] = listBackups(out);
    expect(entry?.verified).toBeNull();
  });

  it("ignores anything that is not a database", async () => {
    const out = dir();
    await runBackup({ dir: out, everyHours: 24, keep: 7 });
    writeFileSync(join(out, "notes.txt"), "x");
    mkdirSync(join(out, "subdir"), { recursive: true });
    expect(listBackups(out)).toHaveLength(1);
  });

  it("returns them newest first", async () => {
    const out = dir();
    const a = await runBackup({ dir: out, everyHours: 24, keep: 7 });
    age(a.file, 48);
    const b = await runBackup({ dir: out, everyHours: 24, keep: 7 });
    expect(listBackups(out)[0]?.file).toBe(b.file);
  });
});

describe("reading the configuration", () => {
  it("defaults to daily, seven kept, next to the database", () => {
    delete process.env.FERRATA_BACKUP_DIR;
    delete process.env.FERRATA_BACKUP_EVERY_HOURS;
    delete process.env.FERRATA_BACKUP_KEEP;
    const c = backupConfig();
    expect(c.everyHours).toBe(24);
    expect(c.keep).toBe(7);
    expect(c.dir).toBe(join(ROOT, "backups"));
  });

  it("falls back to the default rather than to nonsense", () => {
    // A typo in an environment variable must not silently disable backups.
    process.env.FERRATA_BACKUP_EVERY_HOURS = "nightly";
    expect(backupConfig().everyHours).toBe(24);
  });

  it("takes zero as off, because zero is a real answer", () => {
    process.env.FERRATA_BACKUP_EVERY_HOURS = "0";
    expect(backupConfig().everyHours).toBe(0);
  });
});
