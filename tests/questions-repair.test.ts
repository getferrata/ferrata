import { describe, expect, it } from "vitest";
import { repairQuestions } from "@/lib/llm/tasks/write_questions/repair";
import { questionsSchema } from "@/lib/llm/tasks/write_questions/schema";

/**
 * Every malformed payload here was captured from qwen2.5:3b and 7b answering
 * the real write_questions prompt, not invented. The shapes are stable: the
 * same three came back on run after run, and each one used to cost a repair
 * call and often the whole batch.
 */

const ok = (value: unknown) => questionsSchema.safeParse(value).success;

/** The correct answer, stated in full, is what makes any of this recoverable. */
const ANSWER = "Read replicas continue serving requests even while the write pause occurs.";

describe("options the model listed in its own shape", () => {
  it("puts the answer back when only the wrong choices were listed", () => {
    // 3b: correctIndex reserves a slot, incorrectOptions holds the rest, and
    // the right answer is only in expectedAnswer.
    const out = repairQuestions({
      questions: [
        {
          prompt: "When the primary Postgres node fails at Acme, what happens to writes?",
          expectedAnswer: "Writes stop until the replica is promoted.",
          bloomLevel: "apply",
          format: "mcq",
          options: {
            correctIndex: 0,
            incorrectOptions: ["Replicas take over immediately", "Writes continue without pause"],
          },
        },
      ],
    });
    expect(ok(out.value)).toBe(true);
    const parsed = questionsSchema.parse(out.value);
    const o = parsed.questions[0]!.options!;
    expect(o.options).toEqual([
      "Writes stop until the replica is promoted.",
      "Replicas take over immediately",
      "Writes continue without pause",
    ]);
    expect(o.correctIndex).toBe(0);
    expect(o.options[o.correctIndex]).toBe(parsed.questions[0]!.expectedAnswer);
  });

  it("honours the slot the model reserved, not just the first one", () => {
    const out = repairQuestions({
      questions: [
        {
          prompt: "p",
          expectedAnswer: "right",
          bloomLevel: "apply",
          format: "mcq",
          options: { correctIndex: 2, incorrectOptions: ["a", "b", "c"] },
        },
      ],
    });
    const o = questionsSchema.parse(out.value).questions[0]!.options!;
    expect(o.options).toEqual(["a", "b", "right", "c"]);
    expect(o.correctIndex).toBe(2);
  });

  it("reads options keyed by letter, in the order they were written", () => {
    // 3b: {A: {text, correctIndex}, B: ...}. The inner correctIndex is just the
    // ordinal and says nothing about which one is right; the text does.
    const out = repairQuestions({
      questions: [
        {
          prompt: "What should Marco do first?",
          expectedAnswer: "Promote one of the read replicas.",
          bloomLevel: "apply",
          format: "mcq",
          options: {
            A: { text: "Restart the failed primary node immediately.", correctIndex: 0 },
            B: { text: "Promote one of the read replicas.", correctIndex: 1 },
            C: { text: "Notify all users.", correctIndex: 2 },
          },
        },
      ],
    });
    const o = questionsSchema.parse(out.value).questions[0]!.options!;
    expect(o.options).toHaveLength(3);
    expect(o.correctIndex).toBe(1);
  });

  it("reads a bare array of objects and ignores whatever scoring it invented", () => {
    // 7b: [{text, points}]. points looks like a correctness signal and is not
    // one; matching the stated answer is.
    const out = repairQuestions({
      questions: [
        {
          prompt: "Which best describes a read replica during failover?",
          expectedAnswer: ANSWER,
          bloomLevel: 1,
          format: "mcq",
          options: [
            { text: "Read replicas are only used for backups.", points: 9 },
            { text: ANSWER, points: 1 },
          ],
        },
      ],
    });
    const o = questionsSchema.parse(out.value).questions[0]!.options!;
    expect(o.correctIndex).toBe(1);
  });

  it("drops the question when the answer is nowhere in the choices", () => {
    // The one thing it must never do: pick. An mcq that grades the wrong option
    // right is worse than one question fewer.
    const out = repairQuestions({
      questions: [
        {
          prompt: "keep me",
          expectedAnswer: "fine",
          bloomLevel: "apply",
          format: "open",
        },
        {
          prompt: "drop me",
          expectedAnswer: "an answer that appears in none of the choices",
          bloomLevel: "apply",
          format: "mcq",
          options: [{ text: "a" }, { text: "b" }],
        },
      ],
    });
    const parsed = questionsSchema.parse(out.value);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0]!.prompt).toBe("keep me");
    expect(out.notes.join(" ")).toContain("1 question(s) could not be made valid");
  });
});

describe("the other two near misses", () => {
  it("reads a numeric bloomLevel as Bloom's own numbering, from one", () => {
    const out = repairQuestions({
      questions: [
        { prompt: "p", expectedAnswer: "a", bloomLevel: 2, format: "open" },
        { prompt: "q", expectedAnswer: "a", bloomLevel: "3", format: "open" },
      ],
    });
    const parsed = questionsSchema.parse(out.value);
    expect(parsed.questions.map((q) => q.bloomLevel)).toEqual(["understand", "apply"]);
    expect(out.notes.join(" ")).toContain("Bloom");
  });

  it("leaves a number outside the taxonomy alone, and loses that question", () => {
    const out = repairQuestions({
      questions: [
        { prompt: "p", expectedAnswer: "a", bloomLevel: 9, format: "open" },
        { prompt: "q", expectedAnswer: "a", bloomLevel: 1, format: "open" },
      ],
    });
    expect(questionsSchema.parse(out.value).questions).toHaveLength(1);
  });

  it("joins an expectedAnswer that arrived as a list", () => {
    const out = repairQuestions({
      questions: [
        {
          prompt: "p",
          expectedAnswer: ["Check the backend pool", "Then the registry"],
          bloomLevel: "apply",
          format: "open",
        },
      ],
    });
    const parsed = questionsSchema.parse(out.value);
    expect(parsed.questions[0]!.expectedAnswer).toBe(
      "Check the backend pool\nThen the registry",
    );
  });
});

describe("what it must not do", () => {
  it("changes nothing, and says nothing, when the batch was already valid", () => {
    const good = {
      questions: [
        {
          prompt: "p",
          expectedAnswer: "right",
          bloomLevel: "apply",
          format: "mcq",
          options: { options: ["right", "wrong"], correctIndex: 0 },
          misconceptions: [],
        },
      ],
    };
    const out = repairQuestions(good);
    expect(out.notes).toEqual([]);
    expect(questionsSchema.parse(out.value)).toEqual(questionsSchema.parse(good));
  });

  it("hands back the original when nothing survives, so the real error is reported", () => {
    const junk = { questions: [{ nothing: "useful" }] };
    const out = repairQuestions(junk);
    expect(out.value).toBe(junk);
    expect(out.notes).toEqual([]);
    expect(ok(out.value)).toBe(false);
  });

  it("passes through a payload that is not a question batch at all", () => {
    expect(repairQuestions(null).value).toBe(null);
    expect(repairQuestions({ other: 1 }).notes).toEqual([]);
  });

  it("never leaves an mcq whose correctIndex points outside its options", () => {
    // The schema refuses that, and this is the check that the repair does not
    // manufacture one: a reserved slot past the end lands at the end, not past it.
    const out = repairQuestions({
      questions: [
        {
          prompt: "p",
          expectedAnswer: "right",
          bloomLevel: "apply",
          format: "mcq",
          options: { correctIndex: 7, incorrectOptions: ["a", "b"] },
        },
      ],
    });
    const o = questionsSchema.parse(out.value).questions[0]!.options!;
    expect(o.correctIndex).toBeLessThan(o.options.length);
    expect(o.options[o.correctIndex]).toBe("right");
  });
});
