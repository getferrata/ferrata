import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Give the whole suite a throwaway database before any test file is imported.
 *
 * This exists because two test files did not do it for themselves, and opening
 * `@/db` without setting the path opens `./ferrata.db`: the developer's real
 * database. One of the two runs `db.delete(llmCalls)` in a beforeEach, so every
 * `pnpm test` was silently wiping the ledger the receipts, the measured
 * per-module cost and the spend ceiling are all computed from. The suite passed
 * either way, which is why it went unnoticed.
 *
 * Fixed here rather than in those two files on purpose. Patching them would fix
 * the two that exist; a setup file fixes the ones nobody has written yet, which
 * is where the same mistake would land next.
 *
 * A file that wants its own database still sets FERRATA_DB_PATH itself before
 * importing @/db, and that keeps working: this only fills in the default.
 */
process.env.FERRATA_DB_PATH ??= join(
  mkdtempSync(join(tmpdir(), "ferrata-suite-")),
  "test.db",
);
