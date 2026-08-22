import { afterEach, describe, expect, it } from "vitest";
import { moduleConcurrency, workerLanes } from "@/lib/jobs/concurrency";

const KEYS = [
  "FERRATA_MODULE_CONCURRENCY",
  "FERRATA_WORKER_LANES",
  "FERRATA_LITE",
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("moduleConcurrency", () => {
  it("writes four modules at a time by default", () => {
    expect(moduleConcurrency()).toBe(4);
  });

  it("drops to one in lite mode, where the constraint is tokens per minute", () => {
    process.env.FERRATA_LITE = "1";
    expect(moduleConcurrency()).toBe(1);
  });

  it("lets an operator raise lite mode back up explicitly", () => {
    process.env.FERRATA_LITE = "1";
    process.env.FERRATA_MODULE_CONCURRENCY = "3";
    expect(moduleConcurrency()).toBe(3);
  });

  it("clamps a value that would open too many calls on one key", () => {
    process.env.FERRATA_MODULE_CONCURRENCY = "200";
    expect(moduleConcurrency()).toBe(8);
  });

  it("ignores junk and anything below one rather than stalling the build", () => {
    for (const bad of ["0", "-2", "abc", ""]) {
      process.env.FERRATA_MODULE_CONCURRENCY = bad;
      expect(moduleConcurrency()).toBe(4);
    }
  });

  it("is read fresh, so a running worker can be retuned without a restart", () => {
    expect(moduleConcurrency()).toBe(4);
    process.env.FERRATA_MODULE_CONCURRENCY = "2";
    expect(moduleConcurrency()).toBe(2);
  });
});

describe("workerLanes", () => {
  it("runs two jobs side by side by default", () => {
    expect(workerLanes()).toBe(2);
  });

  it("clamps to four", () => {
    process.env.FERRATA_WORKER_LANES = "99";
    expect(workerLanes()).toBe(4);
  });

  it("multiplies with the module ceiling, which is the number that matters", () => {
    // The figure to reason about on a rate-limited tier is the product, not
    // either ceiling on its own.
    process.env.FERRATA_WORKER_LANES = "2";
    process.env.FERRATA_MODULE_CONCURRENCY = "4";
    expect(workerLanes() * moduleConcurrency()).toBe(8);
  });
});
