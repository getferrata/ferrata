import { describe, expect, it } from "vitest";
import { interviewSchema } from "@/lib/llm/tasks/interview_questions/schema";

describe("interviewSchema", () => {
  const q = {
    key: "audience_level",
    question: "Chi studierà questo e cosa sa già?",
    why: "decide i prerequisiti",
  };

  it("accepts 2-6 well-formed questions", () => {
    expect(interviewSchema.safeParse({ questions: [q, q] }).success).toBe(true);
  });

  it("rejects fewer than two questions (no single-question interview)", () => {
    expect(interviewSchema.safeParse({ questions: [q] }).success).toBe(false);
  });

  it("rejects more than six (no generic wall of questions)", () => {
    expect(
      interviewSchema.safeParse({ questions: Array(7).fill(q) }).success,
    ).toBe(false);
  });

  it("requires the why (what each answer sharpens)", () => {
    expect(
      interviewSchema.safeParse({
        questions: [{ key: "k", question: "q?", why: "" }, q],
      }).success,
    ).toBe(false);
  });
});
