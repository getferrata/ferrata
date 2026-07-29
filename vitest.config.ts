import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
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
