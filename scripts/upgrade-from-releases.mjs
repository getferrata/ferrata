import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";

/**
 * Upgrade check: every published release, with data in it, up to this checkout.
 *
 * For each tag: build that release's own database (its own migrations, its own
 * demo seed), add a row to every table the seed leaves empty, run THIS
 * checkout's migrations over it, and require that no row was lost, the database
 * is intact, no foreign key dangles, and the schema is identical to one created
 * from scratch. A fresh install passing says nothing about someone on 1.2.0.
 *
 * Needs the tags (`git fetch --tags`; in CI, fetch-depth 0). Exit 1 on any
 * failure, 2 if there was nothing to check, because a sweep that checked
 * nothing must not read as a pass.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const tsx = join(ROOT, "node_modules/.bin/tsx");
const work = mkdtempSync(join(tmpdir(), "ferrata-upgrade-"));
const SKIP = new Set((process.env.UPGRADE_SKIP_TAGS ?? "").split(",").filter(Boolean));

const tags = git("tag", "--list", "v*", "--sort=v:refname").split("\n").filter((t) => t && !SKIP.has(t));
if (tags.length === 0) {
  console.error("[upgrade] no release tags found (git fetch --tags); refusing to report a pass");
  process.exit(2);
}

function migrate(dbPath) {
  execFileSync(tsx, ["src/db/migrate.ts"], {
    cwd: ROOT,
    env: { ...process.env, FERRATA_DB_PATH: dbPath },
    stdio: "pipe",
  });
}

function snapshot(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  const tables = db
    .prepare("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '\\_\\_%' escape '\\' order by name")
    .all()
    .map((r) => r.name);
  const counts = {};
  const schema = [];
  for (const t of tables) {
    counts[t] = db.prepare(`select count(*) c from "${t}"`).get().c;
    const cols = db.prepare(`pragma table_info("${t}")`).all().map((c) => `${c.name}/${c.type}/${c.notnull}/${c.dflt_value}/${c.pk}`).sort();
    const fks = db.prepare(`pragma foreign_key_list("${t}")`).all().map((f) => `${f.from}>${f.table}.${f.to}:${f.on_delete}`).sort();
    const idx = db.prepare(`pragma index_list("${t}")`).all().filter((i) => !i.name.startsWith("sqlite_")).map((i) => `${i.name}:${i.unique}`).sort();
    schema.push(`${t}: ${cols} | fk:${fks} | idx:${idx}`);
  }
  const integrity = db.pragma("integrity_check")[0].integrity_check;
  const fkViolations = db.pragma("foreign_key_check").length;
  db.close();
  return { counts, schema: schema.join("\n"), integrity, fkViolations };
}

/** One row in every table the demo seed leaves empty, honouring keys and constraints. */
function fill(dbPath) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  const want = ["users", "enrollments", "auth_sessions", "sessions", "reviews", "explanations", "llm_calls", "invites", "jobs", "sources", "source_chunks", "app_settings", "packages", "restorations"];
  const have = new Set(db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name));
  for (const t of want.filter((t) => have.has(t))) {
    if (db.prepare(`select count(*) c from "${t}"`).get().c > 0) continue;
    const fks = Object.fromEntries(db.prepare(`pragma foreign_key_list("${t}")`).all().map((f) => [f.from, f]));
    const row = {};
    for (const c of db.prepare(`pragma table_info("${t}")`).all()) {
      const fk = fks[c.name];
      if (fk) {
        const r = db.prepare(`select "${fk.to ?? "id"}" v from "${fk.table}" limit 1`).get();
        if (r) row[c.name] = r.v;
        continue;
      }
      if (c.name === "email") { row[c.name] = `u${randomUUID()}@fill.dev`; continue; }
      if (c.pk && /char|text/i.test(c.type)) { row[c.name] = "fill_" + randomUUID(); continue; }
      if (!c.notnull || c.dflt_value !== null) continue;
      const ty = c.type.toLowerCase();
      row[c.name] = ty.includes("int") ? 1700000000000 : ty.includes("real") ? 0.5 : "{}";
    }
    const ks = Object.keys(row);
    try {
      db.prepare(`insert into "${t}" (${ks.map((k) => `"${k}"`).join(",")}) values (${ks.map(() => "?").join(",")})`).run(...Object.values(row));
    } catch { /* a table this release cannot fill by rule is left as the seed made it */ }
  }
  db.close();
}

const fresh = join(work, "fresh.db");
migrate(fresh);
const freshSchema = snapshot(fresh).schema;

let failed = 0;
for (const tag of tags) {
  const wt = join(work, `wt-${tag}`);
  const dbPath = join(work, `${tag}.db`);
  const problems = [];
  try {
    git("worktree", "add", "-q", "--detach", wt, tag);
    symlinkSync(join(ROOT, "node_modules"), join(wt, "node_modules"));
    execFileSync(tsx, ["src/db/seed-demo.ts"], { cwd: wt, env: { ...process.env, FERRATA_DB_PATH: dbPath }, stdio: "pipe" });
    fill(dbPath);
    const before = snapshot(dbPath);
    migrate(dbPath);
    const after = snapshot(dbPath);
    for (const [t, n] of Object.entries(before.counts)) {
      if ((after.counts[t] ?? -1) < n) problems.push(`rows lost in ${t}: ${n} -> ${after.counts[t] ?? "table gone"}`);
    }
    if (after.integrity !== "ok") problems.push(`integrity_check: ${after.integrity}`);
    if (after.fkViolations) problems.push(`${after.fkViolations} dangling foreign key(s)`);
    if (after.schema !== freshSchema) problems.push("schema differs from a fresh install");
    const rows = Object.values(before.counts).reduce((a, b) => a + b, 0);
    if (rows < 10) problems.push(`only ${rows} rows to carry over: the check proved nothing`);
    console.log(`[upgrade] ${tag.padEnd(8)} ${rows} rows ${problems.length ? "FAILED" : "ok"}`);
  } catch (e) {
    problems.push(String(e.stderr ?? e.message).split("\n").slice(-4).join(" | "));
  }
  for (const p of problems) console.error(`[upgrade] ${tag}: ${p}`);
  if (problems.length) failed += 1;
  try { git("worktree", "remove", "--force", wt); } catch { /* best effort */ }
}
rmSync(work, { recursive: true, force: true });
if (failed) { console.error(`[upgrade] FAILED: ${failed} of ${tags.length} releases`); process.exit(1); }
console.log(`[upgrade] all ${tags.length} releases upgrade cleanly`);
