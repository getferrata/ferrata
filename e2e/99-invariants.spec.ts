import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { test, expect } from "@playwright/test";

/**
 * Run the database invariants against the state the whole journey left behind.
 *
 * This is the pairing that makes either half worth having. The specs before it
 * drive the product the way a person does (register, build, study, rewrite,
 * add material) and then this one asks whether the state they produced is
 * coherent, without caring which of them produced it. A handler added next year
 * that leaves a ready module with no test fails here without anybody having
 * thought to write a test for that handler.
 *
 * Last by filename on purpose: it wants every other spec's writes in front of
 * it, and the suite runs in order with one worker.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(ROOT, "e2e", ".artifacts", "e2e.db");

test("the journey leaves the database coherent", async () => {
  expect(existsSync(DB), `expected the e2e database at ${DB}`).toBe(true);

  // Pointed at the e2e database before @/db is imported, since importing it is
  // what opens the file.
  process.env.FERRATA_DB_PATH = DB;
  const { checkInvariants, formatViolations } = await import(
    "../src/lib/audit/invariants"
  );

  const violations = checkInvariants();
  expect(violations, formatViolations(violations)).toEqual([]);
});
