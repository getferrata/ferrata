import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const APP_PORT = process.env.E2E_APP_PORT ?? "3100";
const BASE_URL = `http://127.0.0.1:${APP_PORT}`;

// Prefer an explicit system Chromium (E2E_CHROMIUM, or this container's
// preinstalled one); otherwise fall back to Playwright's own download
// (`pnpm exec playwright install chromium` on a dev machine).
const CANDIDATE =
  process.env.E2E_CHROMIUM ??
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EXECUTABLE = existsSync(CANDIDATE) ? CANDIDATE : undefined;

export default defineConfig({
  testDir: "./e2e",
  // Journeys share one database on purpose (register → enroll → study), so
  // they run in order, one worker, like a real single-server install.
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"]],
  outputDir: "e2e/.artifacts/test-results",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    ...(EXECUTABLE ? { launchOptions: { executablePath: EXECUTABLE } } : {}),
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: "node e2e/start.mjs",
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    // The harness builds the app and boots fresh mocks + a fresh DB. On a slow
    // or loaded machine a cold build can take several minutes, so this is
    // generous: a false "webServer timed out" reads as a code failure when it
    // is only the box being busy.
    timeout: 420_000,
  },
});
