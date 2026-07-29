import { describe, expect, it, vi, beforeEach } from "vitest";

const runStructuredTask = vi.fn().mockResolvedValue({ scheduleMd: "## plan" });
vi.mock("@/lib/llm/run", () => ({ runStructuredTask }));

const { runSchedule } = await import("@/lib/llm/tasks/schedule");

const MODULES = [
  {
    title: "The public API",
    priority: "critical",
    estimatedMinutes: 20,
    depthLevel: 3,
    prerequisites: ["The Detector model"],
  },
  {
    title: "The Detector model",
    priority: "high",
    estimatedMinutes: 15,
    depthLevel: 2,
    prerequisites: [],
  },
];

function vars(): Record<string, string> {
  return runStructuredTask.mock.calls[0]?.[0]?.vars ?? {};
}

describe("what the scheduler is given", () => {
  beforeEach(() => {
    runStructuredTask.mockClear();
  });

  it("names what each module must come after", async () => {
    // The prompt invites reordering, and the course shows the learner a
    // prerequisite map. A scheduler that cannot see the edges reorders through
    // them, and the learner is left holding two routes.
    await runSchedule({
      lang: "en",
      deadline: "",
      budgetMinutes: 30,
      modules: MODULES,
    });
    expect(vars().moduleList).toContain("after: The Detector model");
  });

  it("says nothing about order for a module with no prerequisite", async () => {
    await runSchedule({
      lang: "en",
      deadline: "",
      budgetMinutes: 30,
      modules: MODULES,
    });
    const line = vars()
      .moduleList?.split("\n")
      .find((l) => l.startsWith("- The Detector model"));
    expect(line).toBeDefined();
    expect(line).not.toContain("after:");
  });

  it("hands over the arithmetic instead of asking for it", async () => {
    // Asked to add up a column and respect a ceiling at once, a model states it
    // did one while doing neither: the first real plan claimed "240 minutes
    // exactly" over a table summing to 260.
    await runSchedule({
      lang: "en",
      deadline: "",
      budgetMinutes: 30,
      modules: MODULES,
    });
    expect(vars().totalMinutes).toBe("35");
    expect(vars().overBy).toBe("5");
  });

  it("does not report an overrun when everything fits", async () => {
    await runSchedule({
      lang: "en",
      deadline: "",
      budgetMinutes: 120,
      modules: MODULES,
    });
    expect(vars().overBy).toBe("0");
  });

  it("survives a course with no budget at all", async () => {
    await runSchedule({
      lang: "en",
      deadline: "",
      budgetMinutes: null,
      modules: MODULES,
    });
    expect(vars().budgetMinutes).toBe("n/d");
    expect(vars().overBy).toBe("0");
    expect(vars().totalMinutes).toBe("35");
  });
});
