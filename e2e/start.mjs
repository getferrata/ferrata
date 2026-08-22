/**
 * E2e web server launcher, run by Playwright's webServer. Prepares a fresh
 * database (migrations + demo seed), starts the deterministic mock LLM, and
 * boots the app against it on a dedicated port.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(ROOT, "e2e", ".artifacts", "e2e.db");
const APP_PORT = process.env.E2E_APP_PORT ?? "3100";
const MOCK_PORT = process.env.MOCK_LLM_PORT ?? "4545";

mkdirSync(join(ROOT, "e2e", ".artifacts"), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${DB}${suffix}`, { force: true });
}

const WIKI_PORT = process.env.MOCK_WIKI_PORT ?? "4646";

const env = {
  ...process.env,
  FERRATA_DB_PATH: DB,
  OPENAI_API_KEY: "e2e-mock-key",
  OPENAI_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v1`,
  OPENAI_MODEL_HEAVY: "mock-strong",
  OPENAI_MODEL_LIGHT: "mock-fast",
  FERRATA_LITE: "1",
  MOCK_LLM_PORT: MOCK_PORT,
  MOCK_WIKI_PORT: WIKI_PORT,
  // The wiki fixture lives on loopback; this is the documented opt-in for
  // self-hosters whose wiki is on the internal network.
  FERRATA_ALLOW_PRIVATE_URLS: "1",
};

/**
 * Spawned as node against the tool's own JS entry point, not through pnpm.
 *
 * pnpm on Windows is `pnpm.cmd`, and current Node refuses to spawn a `.cmd`
 * without `shell: true`, so this failed there with the seed reporting nothing
 * more useful than a non-zero exit: the whole browser suite could not start on
 * the platform the product is most often installed on.
 *
 * `shell: true` would fix the spawn and break the shutdown below, because kill
 * would reach cmd.exe and leave the server it wrapped holding the port. Going
 * straight to the entry point fixes both, and drops the requirement that pnpm
 * be on PATH at all.
 */
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const NEXT = join(ROOT, "node_modules", "next", "dist", "bin", "next");

const seed = spawnSync(
  process.execPath,
  [TSX, join(ROOT, "src", "db", "seed-demo.ts")],
  { cwd: ROOT, env, stdio: "inherit" },
);
if (seed.status !== 0) {
  console.error("[e2e] demo seed failed");
  process.exit(1);
}

const mock = spawn(process.execPath, [join(ROOT, "e2e", "mock-llm.mjs")], {
  env,
  stdio: "inherit",
});
const wiki = spawn(process.execPath, [join(ROOT, "e2e", "mock-wiki.mjs")], {
  env,
  stdio: "inherit",
});
const app = spawn(
  process.execPath,
  [NEXT, "dev", "--port", APP_PORT],
  { cwd: ROOT, env, stdio: "inherit" },
);

function shutdown() {
  mock.kill("SIGTERM");
  wiki.kill("SIGTERM");
  app.kill("SIGTERM");
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
app.on("exit", (code) => {
  mock.kill("SIGTERM");
  wiki.kill("SIGTERM");
  process.exit(code ?? 0);
});
