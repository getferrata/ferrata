import { describe, expect, it } from "vitest";
import {
  autoGradable,
  countBlanks,
  gradeAnswer,
  normalise,
  parseBlanks,
  parseOptions,
  shuffledOptions,
  toClientQuestion as clientQuestion,
  type GradableQuestion,
} from "@/lib/review/grade";

const mcq: GradableQuestion = {
  format: "mcq",
  optionsJson: JSON.stringify({
    options: [
      "kubectl rollout status deployment/checkout-api -n payments",
      "vault kv get secret/payments/checkout-api",
      "kubectl get secrets -n payments",
    ],
    correctIndex: 1,
  }),
  blanksJson: null,
};

const cloze: GradableQuestion = {
  format: "cloze",
  optionsJson: null,
  blanksJson: JSON.stringify([
    { accept: ["modificano", "cambiano"] },
    { accept: ["modificano", "cambiano"] },
  ]),
};

const open: GradableQuestion = {
  format: "open",
  optionsJson: null,
  blanksJson: null,
};

describe("what the system can settle on its own", () => {
  it("takes a multiple choice", () => {
    expect(autoGradable(mcq)).toBe(true);
  });

  it("takes a cloze once the accepted wordings are stored", () => {
    expect(autoGradable(cloze)).toBe(true);
  });

  it("refuses a cloze from a course built before that field existed", () => {
    // Those courses have a prose explanation where the answer should be.
    // Guessing at it would mark people wrong for being right.
    expect(
      autoGradable({ format: "cloze", optionsJson: null, blanksJson: null }),
    ).toBe(false);
  });

  it("never claims an open question", () => {
    expect(autoGradable(open)).toBe(false);
    expect(
      autoGradable({ format: "explain", optionsJson: null, blanksJson: null }),
    ).toBe(false);
  });

  it("refuses a multiple choice whose stored options are broken", () => {
    for (const bad of [
      null,
      "not json",
      JSON.stringify({ options: ["only one"], correctIndex: 0 }),
      JSON.stringify({ options: ["a", "b"], correctIndex: 5 }),
      JSON.stringify({ options: ["a", "b"], correctIndex: -1 }),
      JSON.stringify({ options: ["a", "b"] }),
    ]) {
      expect(
        autoGradable({ format: "mcq", optionsJson: bad, blanksJson: null }),
        String(bad),
      ).toBe(false);
    }
  });
});

describe("grading a multiple choice", () => {
  it("marks the stored answer right", () => {
    expect(gradeAnswer(mcq, { kind: "choice", index: 1 })).toEqual({
      correct: true,
      gradedBy: "system",
    });
  });

  it("marks anything else wrong", () => {
    expect(gradeAnswer(mcq, { kind: "choice", index: 0 }).correct).toBe(false);
    expect(gradeAnswer(mcq, { kind: "choice", index: 99 }).correct).toBe(false);
  });

  it("ignores a client that grades itself", () => {
    // The point of the whole change: a student cannot press "I had it" on a
    // question the system knows they got wrong.
    const g = gradeAnswer(mcq, { kind: "self", correct: true });
    expect(g.correct).toBe(false);
    expect(g.gradedBy).toBe("system");
  });
});

describe("grading a cloze", () => {
  it("accepts any of the stored wordings, per blank", () => {
    expect(
      gradeAnswer(cloze, { kind: "blanks", values: ["modificano", "cambiano"] })
        .correct,
    ).toBe(true);
  });

  it("forgives case, accents, spacing and stray punctuation", () => {
    expect(
      gradeAnswer(cloze, {
        kind: "blanks",
        values: ["  MODIFICANO. ", "Càmbiano!"],
      }).correct,
    ).toBe(true);
  });

  it("is still a test: a wrong word is wrong", () => {
    expect(
      gradeAnswer(cloze, { kind: "blanks", values: ["leggono", "cambiano"] })
        .correct,
    ).toBe(false);
  });

  it("does not pass a partly filled answer", () => {
    expect(
      gradeAnswer(cloze, { kind: "blanks", values: ["modificano"] }).correct,
    ).toBe(false);
  });
});

describe("grading what only the reader can judge", () => {
  it("records the student's own verdict, and says it was theirs", () => {
    expect(gradeAnswer(open, { kind: "self", correct: true })).toEqual({
      correct: true,
      gradedBy: "self",
    });
    expect(gradeAnswer(open, { kind: "self", correct: false }).correct).toBe(
      false,
    );
  });

  it("falls back to self-grading when a cloze has no stored answers", () => {
    const legacy: GradableQuestion = {
      format: "cloze",
      optionsJson: null,
      blanksJson: null,
    };
    expect(gradeAnswer(legacy, { kind: "self", correct: true })).toEqual({
      correct: true,
      gradedBy: "self",
    });
  });
});

describe("option order", () => {
  const opts = parseOptions(mcq.optionsJson)!;

  it("keeps every option and its original index", () => {
    const out = shuffledOptions(opts.options, "q1");
    expect(out).toHaveLength(3);
    expect([...out].map((o) => o.index).sort()).toEqual([0, 1, 2]);
    for (const o of out) expect(opts.options[o.index]).toBe(o.text);
  });

  it("is stable for the same question, so a reload does not move things", () => {
    expect(shuffledOptions(opts.options, "q1")).toEqual(
      shuffledOptions(opts.options, "q1"),
    );
  });

  it("differs between questions, so position cannot be learned", () => {
    const seeds = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"];
    const positions = new Set(
      seeds.map((s) =>
        shuffledOptions(opts.options, s).findIndex(
          (o) => o.index === opts.correctIndex,
        ),
      ),
    );
    expect(positions.size).toBeGreaterThan(1);
  });
});

describe("the client-safe view of a question", () => {
  const raw = {
    id: "q1",
    prompt: "Which service terminates TLS?",
    bloomLevel: "remember",
    format: "mcq" as const,
    expectedAnswer: "The edge gateway.",
    optionsJson: JSON.stringify({
      options: ["API", "Gateway", "Postgres"],
      correctIndex: 1,
    }),
    blanksJson: null,
  };

  it("ships the option texts but withholds the key in an assessed course", () => {
    const c = clientQuestion(raw, true);
    expect(c.options).toEqual(["API", "Gateway", "Postgres"]);
    expect(c.correctIndex).toBeNull();
    expect(c.expectedAnswer).toBeNull();
    expect(c.autoGraded).toBe(true);
  });

  it("keeps the key for a practice course, where the number is not a measure", () => {
    const c = clientQuestion(raw, false);
    expect(c.correctIndex).toBe(1);
    expect(c.expectedAnswer).toBe("The edge gateway.");
  });

  it("never withholds the answer for a self-graded question", () => {
    // An open question does not count in assessed mode, and the student needs
    // its model answer to self-grade, so it always ships.
    const open = { ...raw, format: "open" as const, optionsJson: null };
    const c = clientQuestion(open, true);
    expect(c.autoGraded).toBe(false);
    expect(c.expectedAnswer).toBe("The edge gateway.");
  });

  it("does not withhold for a cloze the system cannot grade", () => {
    // A legacy cloze with no stored answers is self-graded, so its expected
    // answer must ship even in assessed mode.
    const cloze = {
      ...raw,
      format: "cloze" as const,
      optionsJson: null,
      blanksJson: null,
    };
    const c = clientQuestion(cloze, true);
    expect(c.autoGraded).toBe(false);
    expect(c.expectedAnswer).toBe("The edge gateway.");
  });
});

describe("reading a cloze prompt", () => {
  it("counts the blanks the reader will see", () => {
    expect(
      countBlanks("`kubectl get` non ___ lo stato, `kubectl set image` lo ___."),
    ).toBe(2);
    expect(countBlanks("nessun buco qui")).toBe(0);
  });
});

describe("normalise", () => {
  it("keeps words and numbers, drops the rest", () => {
    expect(normalise("  Réplica-3, ok! ")).toBe("replica-3 ok");
  });

  it("does not collapse two different words into one", () => {
    expect(normalise("read only")).not.toBe(normalise("readonly"));
  });
});

describe("parseBlanks", () => {
  it("refuses shapes that would grade badly", () => {
    for (const bad of [
      null,
      "not json",
      "[]",
      JSON.stringify([{ accept: [] }]),
      JSON.stringify([{ accept: ["  "] }]),
      JSON.stringify(["modificano"]),
    ]) {
      expect(parseBlanks(bad), String(bad)).toBeNull();
    }
  });
});
