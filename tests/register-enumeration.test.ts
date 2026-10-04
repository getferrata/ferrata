import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-regenum-")),
  "test.db",
);
process.env.FERRATA_OPEN_REGISTRATION = "1";

const { db } = await import("@/db");
const { users } = await import("@/db/schema");
const { POST } = await import("@/app/api/auth/register/route");
const { resetThrottle } = await import("@/lib/auth/throttle");

function attempt(email: string) {
  return POST(
    new Request("http://localhost/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email,
        name: "Probe",
        password: "a long enough password",
      }),
    }),
  );
}

beforeEach(() => {
  resetThrottle();
  db.delete(users).run();
  db.insert(users)
    .values({
      id: "user_existing",
      email: "taken@test.dev",
      name: "Taken",
      passwordHash: "x:y",
      role: "student",
    })
    .run();
});

describe("registration does not hand out a free list of who has an account", () => {
  it("stops answering 'already exists' after a handful of probes", async () => {
    // "An account with this email already exists" is a yes/no answer about a
    // person. Unlimited, it enumerates every address in a few minutes; the
    // refusal has to count against the same limit as the other refusals.
    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await attempt("taken@test.dev")).status);
    }
    expect(statuses[0]).toBe(409);
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 409).length).toBeLessThanOrEqual(8);
  }, 90_000);
});
