import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.FERRATA_DB_PATH = join(
  mkdtempSync(join(tmpdir(), "ferrata-spend-")),
  "test.db",
);

const { db } = await import("@/db");
const { concepts, courses, llmCalls, modules } = await import("@/db/schema");
const { courseSpend, measuredPerModuleUsd, formatUsd, formatDuration } =
  await import("@/lib/llm/spend");
const { estimateCourseCost } = await import("@/lib/llm/estimate");
const { newId, now } = await import("@/lib/util/id");

function seedCourse(status: "ready" | "generating" = "ready"): string {
  const id = newId("course");
  db.insert(courses)
    .values({ id, title: "t", sourcePrompt: "p", lang: "en", status })
    .run();
  return id;
}

function seedModule(courseId: string) {
  const conceptId = newId("concept");
  db.insert(concepts)
    .values({ id: conceptId, courseId, title: "c", summary: "s", depthLevel: 1 })
    .run();
  db.insert(modules)
    .values({
      id: newId("module"),
      conceptId,
      kind: "concept",
      bodyMd: "b",
      status: "ready",
    })
    .run();
}

function charge(
  courseId: string,
  usd: number,
  at: number,
  latencyMs = 1000,
  ok = true,
) {
  db.insert(llmCalls)
    .values({
      id: newId("llm"),
      courseId,
      task: "write_module",
      provider: "anthropic",
      model: "claude-sonnet-5",
      tokensIn: 1000,
      tokensOut: 500,
      costUsd: usd,
      latencyMs,
      ok,
      createdAt: at,
    })
    .run();
}

beforeEach(() => {
  db.delete(llmCalls).run();
  db.delete(modules).run();
  db.delete(concepts).run();
  db.delete(courses).run();
});

describe("the receipt for one course", () => {
  it("is nothing at all before any call was made", () => {
    expect(courseSpend(seedCourse())).toBeNull();
  });

  it("adds up spend, calls and tokens", () => {
    const id = seedCourse();
    charge(id, 0.4, 1000);
    charge(id, 0.6, 2000);
    const s = courseSpend(id)!;
    expect(s.usd).toBeCloseTo(1.0, 5);
    expect(s.calls).toBe(2);
    expect(s.tokensIn).toBe(2000);
    expect(s.tokensOut).toBe(1000);
  });

  it("counts the last call's own duration, not just the gap between starts", () => {
    // createdAt is stamped when a call begins, so measuring first-to-last would
    // stop short by however long the final call ran.
    const id = seedCourse();
    charge(id, 0.1, 10_000, 2_000);
    charge(id, 0.1, 15_000, 3_000);
    expect(courseSpend(id)!.elapsedMs).toBe(5_000 + 3_000);
  });

  it("reports retried calls separately, since they were paid for too", () => {
    const id = seedCourse();
    charge(id, 0.1, 1000, 500, false);
    charge(id, 0.1, 2000, 500, true);
    const s = courseSpend(id)!;
    expect(s.calls).toBe(2);
    expect(s.failedCalls).toBe(1);
    expect(s.usd).toBeCloseTo(0.2, 5);
  });

  it("keeps one course's spend out of another's", () => {
    const mine = seedCourse();
    const theirs = seedCourse();
    charge(mine, 1, 1000);
    charge(theirs, 9, 1000);
    expect(courseSpend(mine)!.usd).toBeCloseTo(1, 5);
  });
});

describe("the estimate learns from what was really spent", () => {
  it("says nothing until there is enough history to mean anything", () => {
    const id = seedCourse();
    seedModule(id);
    charge(id, 5, 1000);
    expect(measuredPerModuleUsd()).toBeNull();
  });

  it("averages over finished modules once there are enough", () => {
    const id = seedCourse();
    for (let i = 0; i < 5; i++) seedModule(id);
    charge(id, 5, 1000);
    expect(measuredPerModuleUsd()).toBeCloseTo(1, 5);
  });

  it("ignores courses that never finished", () => {
    // A failed run's spend is real but its modules are not, so counting it
    // would inflate the per-module figure for everyone after.
    const done = seedCourse("ready");
    for (let i = 0; i < 5; i++) seedModule(done);
    charge(done, 5, 1000);
    const broken = seedCourse("generating");
    charge(broken, 100, 1000);
    expect(measuredPerModuleUsd()).toBeCloseTo(1, 5);
  });

  it("uses the measured figure over the built-in one, and says so", () => {
    const guess = estimateCourseCost("anthropic", "claude-sonnet-5");
    expect(guess.measured).toBe(false);
    const known = estimateCourseCost("anthropic", "claude-sonnet-5", 0.25);
    expect(known.measured).toBe(true);
    expect(known.perModuleUsd).toBe(0.25);
  });

  it("falls back when the measurement is absent or nonsense", () => {
    const a = estimateCourseCost("anthropic", "claude-sonnet-5", null);
    const b = estimateCourseCost("anthropic", "claude-sonnet-5", 0);
    expect(a.measured).toBe(false);
    expect(b.measured).toBe(false);
    expect(a.perModuleUsd).toBeGreaterThan(0);
  });

  it("no longer assumes a module is a single call", () => {
    // Each module is written, put through a concreteness pass, judged and given
    // tests, and the first three repeat when the judge is unsatisfied. The old
    // figures assumed one write and came out about three times under.
    const est = estimateCourseCost("anthropic", "claude-sonnet-5");
    expect(est.perModuleUsd).toBeGreaterThan(est.baseUsd);
  });
});

describe("formatting", () => {
  it("says free rather than a row of zeros", () => {
    expect(formatUsd(0)).toBe("free");
  });

  it("does not round a real cost down to nothing", () => {
    expect(formatUsd(0.004)).toBe("under $0.01");
  });

  it("writes minutes when there are minutes", () => {
    expect(formatDuration(38_000)).toBe("38s");
    expect(formatDuration(252_000)).toBe("4m 12s");
  });
});
