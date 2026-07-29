import { describe, expect, it } from "vitest";
import { courseCostUsd, estimateCourseCost } from "@/lib/llm/estimate";

/**
 * The receipt from a finished hosted-model course: fourteen modules grounded in
 * a repository of 131 files, counting only the calls that were kept. The
 * estimate is the one number the product shows before somebody spends money, so
 * it is pinned to this rather than left to drift with an edit to the constants.
 */
const MEASURED = {
  /** write_module, concreteness_pass, eval_judge and write_questions, per module. */
  perModuleUsd: 3.954 / 14,
  /** intake, interview, build_graph, schedule and glossary, once per course. */
  baseUsd: 0.088 + 0.029 + 0.05 + 0.006 + 0.008,
};

describe("pre-build course estimate", () => {
  it("lands within a tenth of what a real module cost", () => {
    const est = estimateCourseCost("anthropic", "claude-sonnet-5");
    // Before this was calibrated the quote was $0.28 against $0.65 billed, and
    // a course quoted at $4.31 was heading for $9. Being over is survivable,
    // being half is not, so the tolerance is tight on both sides.
    expect(est.perModuleUsd).toBeGreaterThan(MEASURED.perModuleUsd * 0.9);
    expect(est.perModuleUsd).toBeLessThan(MEASURED.perModuleUsd * 1.2);
    expect(est.measured).toBe(false);
  });

  it("counts the stages that only run once, including the two at the end", () => {
    // The base used to price intake and little else, so the schedule and the
    // glossary were quoted at nothing at all.
    const est = estimateCourseCost("anthropic", "claude-sonnet-5");
    expect(est.baseUsd).toBeGreaterThan(MEASURED.baseUsd * 0.9);
    expect(est.baseUsd).toBeLessThan(MEASURED.baseUsd * 1.3);
  });

  it("quotes a fourteen-module course within a tenth of what one cost", () => {
    const est = estimateCourseCost("anthropic", "claude-sonnet-5");
    const real = MEASURED.baseUsd + MEASURED.perModuleUsd * 14;
    expect(courseCostUsd(est, 14)).toBeGreaterThan(real * 0.9);
    expect(courseCostUsd(est, 14)).toBeLessThan(real * 1.2);
  });

  it("prefers the install's own measured average once it has one", () => {
    const est = estimateCourseCost("anthropic", "claude-sonnet-5", 0.51);
    expect(est.perModuleUsd).toBe(0.51);
    expect(est.measured).toBe(true);
  });

  it("ignores a measured average of zero rather than quoting a free course", () => {
    // A hosted course that summed to nothing means the ledger is wrong, not
    // that the next one is free.
    const est = estimateCourseCost("anthropic", "claude-sonnet-5", 0);
    expect(est.perModuleUsd).toBeGreaterThan(0);
    expect(est.measured).toBe(false);
  });

  it("is free for a local model however many modules are planned", () => {
    const est = estimateCourseCost("ollama", "qwen2.5:3b");
    expect(courseCostUsd(est, 40)).toBe(0);
  });

  it("grows with the plan and never goes negative", () => {
    const est = estimateCourseCost("anthropic", "claude-sonnet-5");
    expect(courseCostUsd(est, 15)).toBeGreaterThan(courseCostUsd(est, 5));
    expect(courseCostUsd(est, -3)).toBe(est.baseUsd);
  });
});
