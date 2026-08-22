import { describe, expect, it } from "vitest";
import { OUTPUT_CAPS } from "@/lib/llm/tasks/caps";

/**
 * The longest output each stage actually produced on the first hosted-model
 * run. Four of them equalled their ceiling exactly, which is the signature of a
 * ceiling that is too low rather than an answer that is long: the call is
 * retried in full and billed twice.
 */
// concreteness_pass is deliberately absent. Its 8000 was measured while it
// returned the whole module body; it now returns a list of edits, so demanding
// headroom above that figure would size the ceiling for an answer the stage no
// longer produces. The next hosted run replaces it with a real one.
const OBSERVED_LONGEST: Partial<Record<keyof typeof OUTPUT_CAPS, number>> = {
  intake: 4_096,
  interview_questions: 1_312,
  build_graph: 2_757,
  write_module: 6_480,
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

  it("gives the most room to the stage that returns a whole module", () => {
    // write_module is now the only one that emits a full body: the concreteness
    // pass answers with edits, and the two documents made at the end of a
    // course are short. Whoever holds the longest answer should hold the
    // highest ceiling, and today that is the writer.
    const others = Object.entries(OUTPUT_CAPS).filter(
      ([task]) => task !== "write_module",
    );
    for (const [task, cap] of others) {
      expect(cap, `${task} against write_module`).toBeLessThanOrEqual(
        OUTPUT_CAPS.write_module,
      );
    }
  });

  it("no longer sizes the concreteness pass for a whole module", () => {
    // The point of the change: an answer that is a few dozen find/replace pairs
    // does not need the room a rewritten module needed, and the ceiling saying
    // so is what stops it drifting back.
    expect(OUTPUT_CAPS.concreteness_pass).toBeLessThan(OUTPUT_CAPS.write_module);
  });

  it("has a ceiling for every stage, and none of them zero", () => {
    for (const [task, cap] of Object.entries(OUTPUT_CAPS)) {
      expect(cap, `${task} ceiling`).toBeGreaterThan(0);
    }
  });
});
