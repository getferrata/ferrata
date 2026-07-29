import { describe, expect, it } from "vitest";
import { questionsSchema } from "@/lib/llm/tasks/write_questions/schema";

const q = (extra: Record<string, unknown> = {}) => ({
  prompt: "A shot that runs in eight seconds: what is wrong?",
  expectedAnswer: "The grind is too coarse.",
  bloomLevel: "understand",
  format: "open",
  misconceptions: ["The machine is broken."],
  ...extra,
});

function parse(questions: unknown[]) {
  return questionsSchema.safeParse({ questions });
}

describe("what a batch of questions is allowed to look like", () => {
  it("accepts a question that left the misconceptions off", () => {
    // A batch is one call. Requiring this key meant a model that omitted it on
    // one question out of eight threw the other seven away and was billed
    // again to be asked the same thing.
    const parsed = parse([q(), { ...q(), misconceptions: undefined }]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.questions[1]?.misconceptions).toEqual([]);
  });

  it("clamps a generous misconceptions list instead of refusing the batch", () => {
    const many = Array.from({ length: 25 }, (_, i) => `wrong idea ${i}`);
    const parsed = parse([q({ misconceptions: many })]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.questions[0]?.misconceptions).toHaveLength(10);
  });

  it("still refuses an mcq whose right answer is not among its options", () => {
    // The correctness rule, as opposed to the cosmetic ones: this mcq would
    // grade every answer wrong, and no retry cost is worth storing it.
    const parsed = parse([
      q({
        format: "mcq",
        options: { options: ["coarse", "fine"], correctIndex: 2 },
      }),
    ]);
    expect(parsed.success).toBe(false);
  });

  it("accepts a valid mcq", () => {
    const parsed = parse([
      q({
        format: "mcq",
        options: { options: ["coarse", "fine", "stale"], correctIndex: 1 },
      }),
    ]);
    expect(parsed.success).toBe(true);
  });

  it("accepts more options than the old ceiling allowed", () => {
    const parsed = parse([
      q({
        format: "mcq",
        options: {
          options: ["a", "b", "c", "d", "e", "f", "g"],
          correctIndex: 6,
        },
      }),
    ]);
    expect(parsed.success).toBe(true);
  });

  it("still requires a question to have a prompt and an answer", () => {
    expect(parse([q({ prompt: "" })]).success).toBe(false);
    expect(parse([q({ expectedAnswer: "" })]).success).toBe(false);
  });

  it("refuses an empty batch, which is the one case worth a retry", () => {
    expect(parse([]).success).toBe(false);
  });
});
