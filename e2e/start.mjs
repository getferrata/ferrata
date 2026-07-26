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

const seed = spawnSync("pnpm", ["db:seed:demo"], { cwd: ROOT, env, stdio: "inherit" });
if (seed.status !== 0) {
  console.error("[e2e] demo seed failed");
  process.exit(1);
}

const mock = spawn("node", [join(ROOT, "e2e", "mock-llm.mjs")], {
  env,
  stdio: "inherit",
});
const wiki = spawn("node", [join(ROOT, "e2e", "mock-wiki.mjs")], {
  env,
  stdio: "inherit",
});
const app = spawn(
  "pnpm",
  ["exec", "next", "dev", "--port", APP_PORT],
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
