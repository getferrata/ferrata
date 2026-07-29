import { describe, expect, it } from "vitest";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";

/**
 * The longest output each stage actually produced on the first hosted-model
 * run. Four of them equalled their ceiling exactly, which is the signature of a
 * ceiling that is too low rather than an answer that is long: the call is
 * retried in full and billed twice.
 */
const OBSERVED_LONGEST: Partial<Record<keyof typeof OUTPUT_CAPS, number>> = {
  intake: 4_096,
  interview_questions: 1_312,
  build_graph: 2_757,
  write_module: 6_480,
  concreteness_pass: 8_000,
  eval_judge: 2_000,
  write_questions: 3_500,
};

describe("stage output ceilings", () => {
  it("leaves real headroom above the longest answer measured", () => {
    // Headroom is free: a call is billed on the tokens it emits, not on what it
    // was allowed to emit. Sitting level with the observed output is what cost
    // 56 per cent of the first run.
    for (const [task, longest] of Object.entries(OBSERVED_LONGEST)) {
      const cap = OUTPUT_CAPS[task as keyof typeof OUTPUT_CAPS];
      expect(cap, `${task} ceiling`).toBeGreaterThanOrEqual(longest * 1.25);
    }
  });

  it("gives the stage that re-emits a whole module the most room", () => {
    // concreteness_pass rewrites the body write_module produced, so its ceiling
    // has to clear the writing stage's, not match it.
    expect(OUTPUT_CAPS.concreteness_pass).toBeGreaterThan(
      OUTPUT_CAPS.write_module,
    );
  });

  it("has a ceiling for every stage, and none of them zero", () => {
    for (const [task, cap] of Object.entries(OUTPUT_CAPS)) {
      expect(cap, `${task} ceiling`).toBeGreaterThan(0);
    }
  });
});
