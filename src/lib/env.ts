import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Load `.env.local` for anything that is not the Next server.
 *
 * Next reads those files itself, so the app has always had them. A script run
 * with tsx does not, and nothing said so: the two ran side by side against the
 * same database with different environments, and the difference only showed up
 * where a variable mattered.
 *
 * It mattered quietly. FERRATA_SECRET_KEY unset does not fail, it makes every
 * sealed value decrypt to an empty string, so a course exported from the
 * command line came out with the protected values silently deleted while the
 * same course in the browser was intact. FERRATA_DB_PATH unset is worse: the
 * script reads, migrates or backs up a different database than the one the
 * server is using, and every row it prints is real, just not the ones you meant.
 *
 * Same precedence as Next: a variable already in the environment wins, because
 * a value passed on the command line is a deliberate override for that one run
 * and a file must not quietly undo it.
 */

/** Parse the subset of dotenv syntax these files actually use. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      // Only inside double quotes, same as every other reader of these files.
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      // An unquoted value ends at the first comment marker, but only one that
      // follows whitespace: a key like sk-ant-#### keeps its hash.
      value = value.replace(/\s+#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Read `.env.local` and `.env` from `dir` into process.env, without replacing
 * anything already set. Missing files are not an error: most installs have
 * neither. Returns the names it set, for a script that wants to say so.
 */
export function loadLocalEnv(dir: string = process.cwd()): string[] {
  const applied: string[] = [];
  for (const name of [".env.local", ".env"]) {
    const file = resolve(dir, name);
    if (!existsSync(file)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseEnv(readFileSync(file, "utf8"));
    } catch {
      // An unreadable env file must not stop a script that may not need it.
      continue;
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
      applied.push(key);
    }
  }
  return applied;
}
