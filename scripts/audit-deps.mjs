import { execSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Checks the production dependency tree against the npm advisory database.
 *
 * `pnpm audit` is the obvious tool and it fails in this environment: the
 * registry answers gzipped through the proxy and pnpm hands the compressed
 * bytes to JSON.parse. That failure looked like a broken command rather than a
 * missing check, which is how a stack with a critical middleware bypass sat
 * here unnoticed. So the request is made directly, and decompressed properly.
 *
 * Exit code 1 on any advisory, so it can gate a release.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";

function productionTree() {
  const out = execSync("pnpm ls --prod --depth Infinity --json", {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const seen = new Map();
  const walk = (deps) => {
    if (!deps) return;
    for (const [name, info] of Object.entries(deps)) {
      if (info.version) seen.set(`${name}@${info.version}`, { name, version: info.version });
      walk(info.dependencies);
    }
  };
  for (const project of JSON.parse(out)) walk(project.dependencies);
  return seen;
}

const packages = productionTree();

// A sweep that resolved nothing would report "no advisories" and mean it about
// nothing at all. Refuse rather than print a false clean bill.
if (packages.size < 20) {
  console.error(`[deps] resolved only ${packages.size} packages; refusing to report a result`);
  process.exit(2);
}

const body = {};
for (const { name, version } of packages.values()) {
  (body[name] ??= []).push(version);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", "accept-encoding": "gzip" },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error(`[deps] registry answered ${res.status}`);
  process.exit(2);
}

const raw = Buffer.from(await res.arrayBuffer());
let text;
try {
  text = gunzipSync(raw).toString("utf8");
} catch {
  text = raw.toString("utf8");
}
const advisories = JSON.parse(text);

const names = Object.keys(advisories);
console.log(`[deps] ${packages.size} production packages checked`);
if (names.length === 0) {
  console.log("[deps] clean: no known advisories");
  process.exit(0);
}

let worst = 0;
const RANK = { low: 1, moderate: 2, high: 3, critical: 4 };
for (const name of names) {
  for (const a of advisories[name]) {
    worst = Math.max(worst, RANK[a.severity] ?? 0);
    const installed = body[name].join(", ");
    console.error(
      `[deps] ${name} ${installed} matches ${a.vulnerable_versions} [${a.severity}] ${a.title}`,
    );
  }
}
console.error(`[deps] FAILED: ${names.length} package(s) with advisories`);
process.exit(worst >= RANK.moderate ? 1 : 0);
