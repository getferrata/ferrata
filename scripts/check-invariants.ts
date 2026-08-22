import { checkInvariants, formatViolations } from "@/lib/audit/invariants";
import { loadLocalEnv } from "@/lib/env";

/**
 * Point the invariants at whatever database FERRATA_DB_PATH names.
 *
 * Read-only, so it is safe against a live install: run it after an e2e sweep,
 * after a migration, or on a copy of production when something looks wrong.
 * Exits non-zero when anything is broken, so CI can call it without reading
 * the output.
 */
loadLocalEnv();

const violations = checkInvariants();
process.stdout.write(`${formatViolations(violations)}\n`);
process.exit(violations.length > 0 ? 1 : 0);
