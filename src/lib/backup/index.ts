import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { sqlite } from "@/db";
import { getLogger } from "@/lib/log";

const log = getLogger("backup");

/**
 * Backups a person does not have to remember.
 *
 * `pnpm db:backup` was already correct and already useless, for the reason
 * every manual backup is useless: it happens when somebody remembers, and
 * nobody remembers before the upgrade that goes wrong. A real install lost a
 * finished course to exactly that, and the operator had done nothing careless.
 *
 * So the worker takes one on a schedule, verifies it by reading it back, and
 * keeps a handful. The filesystem is the record: a file on disk is a backup, a
 * row saying a backup was taken is a claim. Nothing here consults the database
 * to decide whether the database has been backed up.
 */

/** How the schedule is configured, and what each default is defending. */
export interface BackupConfig {
  /** Where copies go. Never taken from a request. */
  dir: string;
  /** Hours between copies. Zero disables the schedule entirely. */
  everyHours: number;
  /** How many to keep. One is not a backup: it is overwritten by the bad one. */
  keep: number;
}

export interface BackupRecord {
  file: string;
  /** Seconds since the epoch, so it sorts and reads like every other stamp. */
  takenAt: number;
  bytes: number;
  /** What reading the copy back actually found. Absent for a file put here by
   *  hand, which is worth showing as unverified rather than hiding. */
  verified: { courses: number; modules: number; questions: number } | null;
}

const MANIFEST = ".json";

function dbPath(): string {
  return resolve(process.env.FERRATA_DB_PATH ?? "./ferrata.db");
}

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function backupConfig(): BackupConfig {
  return {
    dir: resolve(
      process.env.FERRATA_BACKUP_DIR ?? join(dirname(dbPath()), "backups"),
    ),
    everyHours: num(process.env.FERRATA_BACKUP_EVERY_HOURS, 24),
    // Seven daily copies survive a week away from the machine, which is the
    // gap between a corruption happening and somebody noticing.
    keep: Math.max(1, num(process.env.FERRATA_BACKUP_KEEP, 7)),
  };
}

/**
 * A backup directory inside the served public folder would publish every
 * password hash and API key in the install to anyone who guessed the filename.
 * Refused rather than warned about: there is no configuration in which that is
 * what the operator meant.
 */
export function refusedReason(dir: string): string | null {
  const publicDir = resolve(process.cwd(), "public");
  const rel = relative(publicDir, resolve(dir));
  const insidePublic = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  if (insidePublic) {
    return "the backup directory is inside public/, where the whole database would be downloadable";
  }
  return null;
}

/** Every backup in the directory, newest first. */
export function listBackups(dir = backupConfig().dir): BackupRecord[] {
  if (!existsSync(dir)) return [];
  const out: (BackupRecord & { ms: number })[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".db")) continue;
    const file = join(dir, name);
    let stat;
    try {
      stat = statSync(file);
    } catch {
      continue; // pruned between the listing and the stat
    }
    if (!stat.isFile()) continue;
    let verified: BackupRecord["verified"] = null;
    try {
      const manifest = JSON.parse(
        readFileSync(`${file}${MANIFEST}`, "utf8"),
      ) as { verified?: BackupRecord["verified"] };
      verified = manifest.verified ?? null;
    } catch {
      // No manifest: a file somebody put here themselves. Listed, and honestly
      // marked as never read back.
    }
    out.push({
      file,
      takenAt: Math.floor(stat.mtimeMs / 1000),
      bytes: stat.size,
      verified,
      ms: stat.mtimeMs,
    });
  }
  // Ordered on the full timestamp rather than on the seconds shown, because
  // two copies inside one second are exactly the case pruning must not get
  // wrong: a tie would let it delete whichever the directory listed first.
  return out
    .sort((a, b) => b.ms - a.ms || (a.file < b.file ? 1 : -1))
    .map(({ ms: _ms, ...rest }) => rest);
}

/** Seconds since the newest backup, or null when there is none. */
export function secondsSinceLastBackup(dir?: string): number | null {
  const newest = listBackups(dir)[0];
  return newest ? Math.floor(Date.now() / 1000) - newest.takenAt : null;
}

export function backupIsDue(config = backupConfig()): boolean {
  if (config.everyHours === 0) return false;
  const since = secondsSinceLastBackup(config.dir);
  return since === null || since >= config.everyHours * 3600;
}

/**
 * A path in `dir` that nothing is using yet.
 *
 * The stamp is to the second, and two backups can land inside one: an operator
 * pressing the button twice before an upgrade, or pressing it in the same
 * second the schedule fires. Writing to a name already taken would leave one
 * copy where the operator was looking at two, which is the failure this whole
 * file exists to prevent.
 */
function freeName(dir: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const base = join(dir, `ferrata-${stamp}`);
  if (!existsSync(`${base}.db`)) return `${base}.db`;
  for (let n = 2; n < 1000; n++) {
    if (!existsSync(`${base}-${n}.db`)) return `${base}-${n}.db`;
  }
  throw new Error(`cannot find a free backup name in ${dir}`);
}

/**
 * Take one backup now: copy, read it back, then prune.
 *
 * The copy goes through SQLite's own backup API, because the database runs in
 * WAL mode and copying the one file produces a database silently rolled back to
 * the last checkpoint. Reading it back is not ceremony: a copy nobody has
 * opened is a belief, and the failure mode being defended against is precisely
 * one that looks fine on disk.
 */
export function runBackup(
  config = backupConfig(),
): Promise<BackupRecord> {
  // Serialized, not because two at once would be slow but because two at once
  // are wrong twice over: they share one SQLite connection, and they both pick
  // a filename before either has created a file, so the second silently writes
  // over the first. The scheduled backup and the button can and do overlap.
  const next = chain.then(
    () => takeBackup(config),
    () => takeBackup(config),
  );
  chain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

let chain: Promise<void> = Promise.resolve();

async function takeBackup(config: BackupConfig): Promise<BackupRecord> {
  const refusal = refusedReason(config.dir);
  if (refusal) throw new Error(refusal);

  const source = dbPath();
  if (!existsSync(source)) throw new Error(`no database at ${source}`);
  mkdirSync(config.dir, { recursive: true });

  const file = freeName(config.dir);

  await sqlite().backup(file);

  // Read back through the connection that is already open, attached, rather
  // than by opening a second one.
  //
  // A second connection is the obvious way to read another file and it is what
  // this did, and on Windows it ended the process. Opening the native module
  // registers a cleanup hook per environment, and closing a connection tears
  // down the statement objects behind it; when that teardown lands while an
  // environment is going away, Node aborts on a failed assertion rather than
  // throwing, so the output is a native stack with no JavaScript in it and the
  // server dies about a second after saying it was ready. ATTACH does the same
  // job on the handle that is already open: no second module state, no close,
  // and the counts come from the copy on disk exactly as before.
  const conn = sqlite();
  conn.prepare("ATTACH DATABASE ? AS backup_check").run(file);
  let verified: BackupRecord["verified"];
  try {
    const count = (table: string) =>
      (
        conn
          .prepare(`select count(*) as n from backup_check.${table}`)
          .get() as { n: number }
      ).n;
    verified = {
      courses: count("courses"),
      modules: count("modules"),
      questions: count("questions"),
    };
  } finally {
    conn.prepare("DETACH DATABASE backup_check").run();
  }

  const record: BackupRecord = {
    file,
    takenAt: Math.floor(Date.now() / 1000),
    bytes: statSync(file).size,
    verified,
  };
  writeFileSync(`${file}${MANIFEST}`, JSON.stringify(record), "utf8");
  prune(config);
  log.info("backup taken", {
    file,
    courses: verified.courses,
    modules: verified.modules,
  });
  return record;
}

/** Keep the newest `keep`, and take each one's manifest with it. */
export function prune(config = backupConfig()): number {
  const all = listBackups(config.dir);
  const doomed = all.slice(config.keep);
  for (const b of doomed) {
    rmSync(b.file, { force: true });
    rmSync(`${b.file}${MANIFEST}`, { force: true });
  }
  return doomed.length;
}
