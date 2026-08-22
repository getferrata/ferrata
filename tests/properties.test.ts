import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { breakCycles, findCycle, topoSort, type DagEdge } from "@/lib/graph/dag";
import { triage, type TriageConcept } from "@/lib/graph/triage";
import { chunkText } from "@/lib/sources/chunk";
import { extractJson } from "@/lib/llm/json";
import {
  gradeAnswer,
  normalise,
  parseBlanks,
  parseOptions,
  shuffledOptions,
} from "@/lib/review/grade";
import { canonicalise } from "@/lib/course/attestation";
import { repairQuestions } from "@/lib/llm/tasks/write_questions/repair";
import { questionsSchema } from "@/lib/llm/tasks/write_questions/schema";
import { mapWithConcurrency } from "@/lib/util/pool";
import { splitPrompt } from "@/lib/llm/run";

/**
 * Properties, as opposed to examples.
 *
 * The rest of the suite says "given this input, expect that output", and every
 * one of those inputs was thought of by whoever wrote the code. That is the
 * gap: the cases nobody imagined are exactly the ones that are not there. These
 * tests state what must be true of *every* input and let a generator go looking
 * for the counter-example, which is the one job a machine does better than the
 * person who wrote the function.
 *
 * A property that fails here is not a flaky test. fast-check shrinks the
 * counter-example to its smallest form and prints the seed; the failure is
 * reproducible and usually two lines long.
 */

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

/** True when no -0 hides anywhere inside, however deep. */
function noNegativeZero(value: unknown): boolean {
  if (Object.is(value, -0)) return false;
  if (Array.isArray(value)) return value.every(noNegativeZero);
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(noNegativeZero);
  }
  return true;
}

/** A graph over a small id space, so edges collide and cycles actually happen. */
const graphArb = fc
  .integer({ min: 1, max: 8 })
  .chain((n) => {
    const ids = Array.from({ length: n }, (_, i) => `c${i}`);
    return fc.record({
      ids: fc.constant(ids),
      // Self-edges are dropped from the generated array, never filtered out of
      // the element arbitrary: on a one-node graph the only pair it can make is
      // c0 to c0, and a filter that rejects every candidate starves the
      // generator instead of producing a small graph.
      edges: fc
        .array(fc.tuple(fc.constantFrom(...ids), fc.constantFrom(...ids)), {
          maxLength: 20,
        })
        .map((pairs): DagEdge[] =>
          pairs
            .filter(([from, to]) => from !== to)
            .map(([from, to]) => ({ from, to })),
        ),
      priorities: fc.array(fc.constantFrom(...PRIORITIES), {
        minLength: n,
        maxLength: n,
      }),
    });
  });

describe("the prerequisite graph", () => {
  it("comes out of breakCycles acyclic, whatever went in", () => {
    fc.assert(
      fc.property(graphArb, ({ ids, edges, priorities }) => {
        const priorityOf = (id: string) =>
          priorities[ids.indexOf(id)] ?? "medium";
        const { edges: kept } = breakCycles(ids, edges, priorityOf);
        expect(findCycle(ids, kept)).toBeNull();
      }),
    );
  });

  it("never invents an edge while breaking cycles", () => {
    // Removing too many is a quality problem; adding one is a correctness
    // problem, because it would impose a prerequisite nobody asked for.
    fc.assert(
      fc.property(graphArb, ({ ids, edges, priorities }) => {
        const priorityOf = (id: string) =>
          priorities[ids.indexOf(id)] ?? "medium";
        const { edges: kept, removed } = breakCycles(ids, edges, priorityOf);
        expect(kept.length + removed.length).toBe(edges.length);
        for (const e of kept) {
          expect(edges).toContainEqual({ from: e.from, to: e.to });
        }
      }),
    );
  });

  it("can always be sorted after being broken, which is what the pipeline does", () => {
    // build_graph calls these two back to back. If the composition can throw,
    // it throws in the middle of a paid build.
    fc.assert(
      fc.property(graphArb, ({ ids, edges, priorities }) => {
        const priorityOf = (id: string) =>
          priorities[ids.indexOf(id)] ?? "medium";
        const { edges: kept } = breakCycles(ids, edges, priorityOf);
        const order = topoSort(ids, kept);
        expect(order.slice().sort()).toEqual(ids.slice().sort());
        for (const e of kept) {
          expect(order.indexOf(e.from)).toBeLessThan(order.indexOf(e.to));
        }
      }),
    );
  });
});

describe("cutting the plan to the time budget", () => {
  const conceptsArb = fc.array(
    fc.record({
      id: fc.string({ minLength: 1, maxLength: 4 }),
      title: fc.string({ maxLength: 8 }),
      priority: fc.constantFrom(...PRIORITIES),
      estimatedMinutes: fc.integer({ min: 0, max: 120 }),
    }),
    { minLength: 1, maxLength: 8 },
  );

  /** Distinct ids, since two concepts sharing one is not a real input. */
  const planArb = conceptsArb
    .map((cs) =>
      cs.filter((c, i) => cs.findIndex((o) => o.id === c.id) === i),
    )
    .chain((concepts: TriageConcept[]) =>
      fc.record({
        concepts: fc.constant(concepts),
        edges: fc
          .array(
            fc.tuple(
              fc.constantFrom(...concepts.map((c) => c.id)),
              fc.constantFrom(...concepts.map((c) => c.id)),
            ),
            { maxLength: 12 },
          )
          .map((pairs): DagEdge[] =>
            pairs
              .filter(([from, to]) => from !== to)
              .map(([from, to]) => ({ from, to })),
          ),
        budget: fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
      }),
    );

  it("keeps or cuts every concept, never loses or duplicates one", () => {
    fc.assert(
      fc.property(planArb, ({ concepts, edges, budget }) => {
        const out = triage(concepts, edges, budget);
        const seen = [...out.survivorIds, ...out.cuts.map((c) => c.id)];
        expect(seen.slice().sort()).toEqual(
          concepts.map((c) => c.id).sort(),
        );
      }),
    );
  });

  it("never cuts a prerequisite of something it kept", () => {
    // The stated contract, and the one that matters: a survivor whose
    // prerequisite was cut is a module that teaches something the student was
    // never given the ground for.
    fc.assert(
      fc.property(planArb, ({ concepts, edges, budget }) => {
        const out = triage(concepts, edges, budget);
        const kept = new Set(out.survivorIds);
        const cut = new Set(out.cuts.map((c) => c.id));
        for (const e of edges) {
          if (kept.has(e.to)) expect(cut.has(e.from)).toBe(false);
        }
      }),
    );
  });

  it("never cuts a critical or high concept, however tight the budget", () => {
    fc.assert(
      fc.property(planArb, ({ concepts, edges, budget }) => {
        const out = triage(concepts, edges, budget);
        const byId = new Map(concepts.map((c) => [c.id, c]));
        for (const c of out.cuts) {
          const p = byId.get(c.id)?.priority;
          expect(p === "low" || p === "medium").toBe(true);
        }
      }),
    );
  });

  it("reports honestly whether what is left actually fits", () => {
    fc.assert(
      fc.property(planArb, ({ concepts, edges, budget }) => {
        const out = triage(concepts, edges, budget);
        const byId = new Map(concepts.map((c) => [c.id, c]));
        const sum = out.survivorIds.reduce(
          (s, id) => s + (byId.get(id)?.estimatedMinutes ?? 0),
          0,
        );
        expect(out.totalMinutes).toBe(sum);
        if (budget !== null) expect(out.feasible).toBe(sum <= budget);
      }),
    );
  });
});

describe("chunking source text", () => {
  /**
   * Text with the shape real material has: paragraphs, blank lines, sentences.
   *
   * A plain fc.string() is not enough here, and finding that out was half the
   * value of writing these. The size and overlap properties below passed
   * against random strings for a reason that had nothing to do with the code
   * being right: a random string almost never contains a blank line, so the
   * paragraph-packing branch was never entered and the whole interesting half
   * of the function went untested while the suite reported green.
   */
  const paragraphish = fc
    .array(
      fc.array(fc.string({ minLength: 1, maxLength: 15 }), {
        minLength: 1,
        maxLength: 12,
      }),
      { minLength: 1, maxLength: 8 },
    )
    .map((paras) => paras.map((words) => words.join(" ")).join("\n\n"));

  const textArb = fc.oneof(fc.string({ maxLength: 2000 }), paragraphish);

  it("never emits an empty chunk", () => {
    // An empty chunk is a row in source_chunks that grounds nothing, takes a
    // slot in retrieval, and can be handed to a model as an excerpt.
    fc.assert(
      fc.property(textArb, fc.integer({ min: 20, max: 300 }), (raw, max) => {
        for (const c of chunkText(raw, max)) {
          expect(c.text.trim().length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("numbers the chunks from zero without a gap", () => {
    fc.assert(
      fc.property(textArb, fc.integer({ min: 20, max: 300 }), (raw, max) => {
        const chunks = chunkText(raw, max);
        expect(chunks.map((c) => c.ord)).toEqual(chunks.map((_, i) => i));
      }),
    );
  });

  it("keeps every chunk inside the size it was given", () => {
    // The budget is what keeps a grounding prompt predictable. A chunk over it
    // is paid for on every module that retrieves it.
    fc.assert(
      fc.property(textArb, fc.integer({ min: 20, max: 300 }), (raw, max) => {
        for (const c of chunkText(raw, max)) {
          expect(c.text.length).toBeLessThanOrEqual(max);
        }
      }),
    );
  });

  it("loses no word of the input", () => {
    // Overlap means the chunks are not a partition, so the check is coverage:
    // every non-space run in the input appears whole in some chunk. A run
    // longer than the cap is the one exception, because there is nowhere to put
    // it that does not cut it.
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 40 }),
        fc.integer({ min: 40, max: 300 }),
        (words, max) => {
          const raw = words.join(" ").replace(/\s+/g, " ").trim();
          if (!raw) return;
          const chunks = chunkText(raw, max).map((c) => c.text);
          for (const w of raw.split(" ")) {
            if (w && w.length <= max) {
              expect(chunks.some((c) => c.includes(w))).toBe(true);
            }
          }
        },
      ),
    );
  });
});

describe("parsers that are handed whatever the model said", () => {
  it("extractJson either returns a value or throws, but never hangs on junk", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (raw) => {
        try {
          extractJson(raw);
        } catch {
          // Throwing is a fine answer; the caller retries. Anything else here
          // would be a crash inside a paid call.
        }
      }),
    );
  });

  it("extractJson round-trips anything the schemas actually produce", () => {
    fc.assert(
      // Negative zero excluded, and the exclusion is the finding rather than a
      // convenience. JSON.stringify(-0) is "0", so -0 is the one JSON value
      // that cannot survive a round trip through text, in this parser or any
      // other. This property has been in the suite for a while and failed only
      // when a seed happened to generate it: a full run went red once with no
      // usable output, which reads as a flake and is not one. No field in any
      // schema is a number whose sign of zero means anything, so the honest
      // move is to narrow the claim rather than to widen the parser.
      fc.property(fc.jsonValue().filter(noNegativeZero), (value) => {
        expect(extractJson(JSON.stringify(value))).toEqual(value);
      }),
    );
  });

  it("the stored-answer parsers never throw on a malformed column", () => {
    // These read a text column written by an earlier version of the code. A
    // throw here is a student's review session dying on somebody else's bug.
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        expect(() => parseOptions(raw)).not.toThrow();
        expect(() => parseBlanks(raw)).not.toThrow();
      }),
    );
  });

  it("normalise is idempotent, or grading depends on how often it ran", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (s) => {
        expect(normalise(normalise(s))).toBe(normalise(s));
      }),
    );
  });
});

describe("the pieces added this week", () => {
  it("splitPrompt loses no text at the marker", () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 80 }),
        fc.string({ maxLength: 80 }),
        (a, b) => {
          const split = splitPrompt(`${a}\n---PER-CALL---\n${b}`);
          const text =
            typeof split === "string"
              ? split
              : `${split.stable}${split.perCall ?? ""}`;
          expect(text).toContain(a.trim());
          expect(text).toContain(b.trim());
        },
      ),
    );
  });

  it("mapWithConcurrency returns input order and runs each item once", () => {
    return fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 30 }),
        fc.integer({ min: 1, max: 8 }),
        async (items, limit) => {
          const seen: number[] = [];
          const out = await mapWithConcurrency(items, limit, async (n, i) => {
            await new Promise((r) => setTimeout(r, n % 3));
            seen.push(i);
            return n * 2;
          });
          expect(out).toEqual(items.map((n) => n * 2));
          expect(seen.slice().sort((a, b) => a - b)).toEqual(
            items.map((_, i) => i),
          );
        },
      ),
    );
  });
});

/**
 * A JSON-ish value, deep enough that key order and nesting both get exercised.
 * Keys come from a small pool so two generated objects collide often, which is
 * what makes the ordering property meaningful rather than vacuous.
 */
const jsonArb = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    fc.string(),
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie("value"), { maxLength: 4 }),
    fc.dictionary(fc.constantFrom("a", "b", "c", "id", "at", "n"), tie("value"), {
      maxKeys: 5,
    }),
  ),
})).value;

/** Rebuild an object with its keys inserted in a different order, recursively. */
function reorder(value: unknown, rng: () => number): unknown {
  if (Array.isArray(value)) return value.map((v) => reorder(v, rng));
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>);
  for (let i = entries.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [entries[i], entries[j]] = [entries[j]!, entries[i]!];
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) out[k] = reorder(v, rng);
  return out;
}

describe("the bytes an attestation is signed over", () => {
  it("does not depend on the order the object was built in", () => {
    // The whole reason canonicalise exists. JSON.stringify follows insertion
    // order, so a refactor assembling the same body differently would
    // invalidate every document ever issued without changing one value.
    fc.assert(
      fc.property(jsonArb, fc.integer({ min: 0, max: 2 ** 31 }), (value, seed) => {
        let h = seed || 1;
        const rng = () => {
          h = (h * 1103515245 + 12345) % 2147483648;
          return h / 2147483648;
        };
        expect(canonicalise(reorder(value, rng))).toBe(canonicalise(value));
      }),
    );
  });

  it("changes whenever any value changes, or a document could be edited freely", () => {
    fc.assert(
      fc.property(jsonArb, fc.string(), (value, extra) => {
        // Appending a field is a change to the claim, so it must be a change to
        // the bytes. If it were not, an auditor's copy could gain a line the
        // signature still covers.
        const before = canonicalise(value);
        const after = canonicalise({ wrapped: value, extra });
        expect(after).not.toBe(before);
      }),
    );
  });
});

describe("showing a multiple choice to a reader", () => {
  it("shuffles into a permutation, losing and duplicating nothing", () => {
    // A dropped option is a question with no right answer in it; a duplicated
    // one is two right answers. Both look like the student being wrong.
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 8 }),
        fc.string(),
        (options, seed) => {
          const out = shuffledOptions(options, seed);
          expect(out).toHaveLength(options.length);
          expect(out.map((o) => o.index).sort((a, b) => a - b)).toEqual(
            options.map((_, i) => i),
          );
          expect(out.map((o) => o.text).sort()).toEqual([...options].sort());
          // The mapping has to stay true: every text sits at its own index.
          for (const o of out) expect(options[o.index]).toBe(o.text);
        },
      ),
    );
  });

  it("shuffles the same way twice, so a reload is not a new question", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 8 }),
        fc.string(),
        (options, seed) => {
          expect(shuffledOptions(options, seed)).toEqual(
            shuffledOptions(options, seed),
          );
        },
      ),
    );
  });
});

describe("settling an answer", () => {
  const mcq = (options: string[], correctIndex: number) => ({
    format: "mcq" as const,
    optionsJson: JSON.stringify({ options, correctIndex }),
    blanksJson: null,
  });

  it("marks the stored index right and every other index wrong", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 6 }),
        fc.nat(),
        fc.integer({ min: -3, max: 9 }),
        (options, rawCorrect, chosen) => {
          const correctIndex = rawCorrect % options.length;
          const q = mcq(options, correctIndex);
          const grade = gradeAnswer(q, { kind: "choice", index: chosen });
          expect(grade.correct).toBe(chosen === correctIndex);
          expect(grade.gradedBy).toBe("system");
        },
      ),
    );
  });

  it("never lets a claim of being right settle a question the system can settle", () => {
    // The assessed-mode hole, stated as a rule rather than as one request: a
    // client that says it was right about a multiple choice it got wrong
    // changes nothing, whatever it sends.
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1 }), { minLength: 2, maxLength: 6 }),
        fc.nat(),
        fc.boolean(),
        (options, rawCorrect, claim) => {
          const q = mcq(options, rawCorrect % options.length);
          const grade = gradeAnswer(q, { kind: "self", correct: claim });
          expect(grade.correct).toBe(false);
          expect(grade.gradedBy).toBe("system");
        },
      ),
    );
  });

  it("accepts a cloze answer however it was capitalised or accented", () => {
    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 1, maxLength: 12 }), {
          minLength: 1,
          maxLength: 3,
        }),
        (accepted) => {
          const q = {
            format: "cloze" as const,
            optionsJson: null,
            blanksJson: JSON.stringify(accepted.map((a) => ({ accept: [a] }))),
          };
          const typed = accepted.map((a) => ` ${a.toUpperCase()} `);
          const grade = gradeAnswer(q, { kind: "blanks", values: typed });
          // Only when the stored wordings are ones the parser will accept. A
          // blank whose accepted answer is blank is refused on purpose, back at
          // parseBlanks, and the question falls through to the reader's own
          // judgement: guessing at an answer the generator never gave would
          // grade people wrongly, which is worse than not grading them. The
          // first draft of this property asserted system grading for every
          // input and failed on a single space, which was the property being
          // wrong about the product rather than the other way round.
          if (accepted.every((a) => a.trim().length > 0)) {
            expect(grade.gradedBy).toBe("system");
            if (accepted.every((a) => normalise(a).length > 0)) {
              expect(grade.correct).toBe(true);
            }
          }
        },
      ),
    );
  });
});

describe("repairing a nearly-right batch of questions", () => {
  const questionArb = fc.record({
    prompt: fc.string({ minLength: 1 }),
    expectedAnswer: fc.string({ minLength: 1 }),
    bloomLevel: fc.oneof(
      fc.constantFrom("remember", "understand", "apply"),
      fc.integer({ min: 0, max: 9 }),
      fc.constantFrom("2", "3", "nonsense"),
    ),
    format: fc.constantFrom("open", "mcq", "cloze", "explain"),
    options: fc.oneof(
      fc.constant(undefined),
      fc.array(fc.string({ minLength: 1 }), { maxLength: 4 }),
      fc.array(fc.record({ text: fc.string({ minLength: 1 }) }), { maxLength: 4 }),
      fc.record({
        correctIndex: fc.nat({ max: 5 }),
        incorrectOptions: fc.array(fc.string({ minLength: 1 }), { maxLength: 3 }),
      }),
    ),
  });

  it("never hands back an option nobody sent", () => {
    // The one thing this layer must not do is decide the answer. Every option
    // it emits has to have arrived, either in the list or as the stated answer.
    fc.assert(
      fc.property(fc.array(questionArb, { maxLength: 5 }), (questions) => {
        const out = repairQuestions({ questions });
        const parsed = questionsSchema.safeParse(out.value);
        if (!parsed.success) return;
        for (const [i, q] of parsed.data.questions.entries()) {
          if (!q.options) continue;
          const source = questions.find((x) => x.prompt === q.prompt) ?? questions[i];
          const offered = new Set<string>([
            String(source?.expectedAnswer ?? ""),
            ...(Array.isArray(source?.options)
              ? source.options.map((o) => (typeof o === "string" ? o : o.text))
              : []),
            ...(source?.options &&
            !Array.isArray(source.options) &&
            "incorrectOptions" in source.options
              ? source.options.incorrectOptions
              : []),
          ]);
          for (const text of q.options.options) expect(offered.has(text)).toBe(true);
        }
      }),
    );
  });

  it("never points correctIndex past the end of the options", () => {
    fc.assert(
      fc.property(fc.array(questionArb, { maxLength: 5 }), (questions) => {
        const parsed = questionsSchema.safeParse(repairQuestions({ questions }).value);
        if (!parsed.success) return;
        for (const q of parsed.data.questions) {
          if (!q.options) continue;
          expect(q.options.correctIndex).toBeLessThan(q.options.options.length);
          expect(q.options.correctIndex).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("keeps a subset of what arrived, never more", () => {
    fc.assert(
      fc.property(fc.array(questionArb, { maxLength: 5 }), (questions) => {
        const parsed = questionsSchema.safeParse(repairQuestions({ questions }).value);
        if (!parsed.success) return;
        expect(parsed.data.questions.length).toBeLessThanOrEqual(questions.length);
        const prompts = new Set(questions.map((q) => q.prompt));
        for (const q of parsed.data.questions) expect(prompts.has(q.prompt)).toBe(true);
      }),
    );
  });

  it("settles: repairing an already-repaired batch changes nothing", () => {
    // A layer that keeps rewriting its own output would drift a course further
    // from what the model said every time a retry passed through it.
    fc.assert(
      fc.property(fc.array(questionArb, { maxLength: 5 }), (questions) => {
        const once = repairQuestions({ questions }).value;
        expect(repairQuestions(once).value).toEqual(once);
      }),
    );
  });
});
