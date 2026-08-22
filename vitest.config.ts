import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // Runs before any test file is imported, so nothing can reach the real
    // ./ferrata.db by forgetting to point somewhere else. See the file.
    setupFiles: ["tests/setup-db.ts"],
    // Several tests drive failure paths on purpose (a value that will not
    // decrypt, a provider that refuses), and the code is right to log those. In
    // a passing run they read as breakage, so the suite runs quiet; a test that
    // is about logging sets its own level.
    env: { FERRATA_LOG_LEVEL: "silent" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
