import { describe, expect, it } from "vitest";
import { judgeSchema, normaliseJudge } from "@/lib/llm/tasks/eval_judge/schema";

const verdict = (issues: string[]) => ({
  pass: false,
  score: 0.4,
  issues,
  specificityViolations: issues,
  groundingViolations: issues,
});

describe("eval_judge verdict", () => {
  it("accepts a verdict that lists more problems than the repair step uses", () => {
    // Rejecting it used to cost a full second call to be told the same thing
    // more briefly, on the stage that already runs once per module attempt.
    const many = Array.from({ length: 45 }, (_, i) => `problem ${i}`);
    const parsed = judgeSchema.safeParse(verdict(many));
    expect(parsed.success).toBe(true);
  });

  it("clamps every list to the cap the repair step acts on", () => {
    const many = Array.from({ length: 45 }, (_, i) => `problem ${i}`);
    const out = normaliseJudge(verdict(many));
    expect(out.issues).toHaveLength(30);
    expect(out.specificityViolations).toHaveLength(30);
    expect(out.groundingViolations).toHaveLength(30);
    // The kept entries are the first ones, not an arbitrary slice.
    expect(out.issues[0]).toBe("problem 0");
  });

  it("still fills in a missing groundingViolations key", () => {
    const out = normaliseJudge({
      pass: true,
      score: 1,
      issues: [],
      specificityViolations: [],
    });
    expect(out.groundingViolations).toEqual([]);
  });
});
