import { beforeEach, describe, expect, it, vi } from "vitest";

const runWriteQuestions = vi.fn();
vi.mock("@/lib/llm/tasks/write_questions", () => ({
  runWriteQuestions,
  questionsSchema: {},
}));

const { writeQuestionRows } = await import("@/lib/jobs/handlers");

const COURSE = { lang: "en", sourcePrompt: "brief" };

function concept(depthLevel: number) {
  return {
    id: "concept_1",
    courseId: "course_1",
    title: "Reading a choked group head",
    summary: "The pump whines and nothing comes out.",
    priority: "high" as const,
    estimatedMinutes: 20,
    depthLevel,
    topoOrder: 0,
    videoRefsJson: null,
    retiredAt: null,
  };
}

function question(prompt: string) {
  return {
    prompt,
    expectedAnswer: "answer",
    bloomLevel: "understand",
    format: "open",
    options: null,
    misconceptions: [],
  };
}

function countsAsked(): number[] {
  return runWriteQuestions.mock.calls.map((c) => c[0].count as number);
}

describe("when the test writer comes back empty", () => {
  beforeEach(() => {
    runWriteQuestions.mockReset();
  });

  it("asks for half, not for one", async () => {
    // On the first hosted-model run every depth-3 module took this path, and
    // the retry at one turned the hardest material in the course into a single
    // question. One question cannot measure whether anybody learned a module.
    runWriteQuestions
      .mockResolvedValueOnce({ questions: [] })
      .mockResolvedValueOnce({ questions: [question("a"), question("b")] });
    const rows = await writeQuestionRows("course_1", COURSE, concept(3), "body");
    expect(countsAsked()).toEqual([8, 4]);
    expect(rows).toHaveLength(2);
  });

  it("never asks for fewer than two, however shallow the module", async () => {
    runWriteQuestions
      .mockResolvedValueOnce({ questions: [] })
      .mockResolvedValueOnce({ questions: [question("a")] });
    await writeQuestionRows("course_1", COURSE, concept(0), "body");
    expect(countsAsked()[1]).toBeGreaterThanOrEqual(2);
  });

  it("costs one retry, not two", async () => {
    runWriteQuestions.mockResolvedValue({ questions: [] });
    const rows = await writeQuestionRows("course_1", COURSE, concept(3), "body");
    expect(runWriteQuestions).toHaveBeenCalledTimes(2);
    expect(rows).toEqual([]);
  });

  it("does not retry when the first call answered", async () => {
    runWriteQuestions.mockResolvedValueOnce({
      questions: [question("a"), question("b")],
    });
    await writeQuestionRows("course_1", COURSE, concept(2), "body");
    expect(countsAsked()).toEqual([6]);
  });

  it("keeps a short answer rather than paying to try again", async () => {
    // Fewer than asked is a warning, not a failure: the module has tests.
    runWriteQuestions.mockResolvedValueOnce({ questions: [question("a")] });
    const rows = await writeQuestionRows("course_1", COURSE, concept(3), "body");
    expect(runWriteQuestions).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });

  it("survives the writer throwing on both attempts", async () => {
    runWriteQuestions.mockRejectedValue(new Error("provider down"));
    const rows = await writeQuestionRows("course_1", COURSE, concept(3), "body");
    expect(rows).toEqual([]);
  });
});
