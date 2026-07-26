import { describe, expect, it } from "vitest";
import { extractJson } from "@/lib/llm/json";
import { intakeSchema } from "@/lib/llm/tasks/intake/schema";

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("recovers JSON from a ```json fence", () => {
    const raw = "Here you go:\n```json\n{\"a\": [1,2,3]}\n```\nDone.";
    expect(extractJson(raw)).toEqual({ a: [1, 2, 3] });
  });

  it("recovers the first balanced object with surrounding prose", () => {
    const raw = 'sure: {"a": {"b": 2}} trailing text';
    expect(extractJson(raw)).toEqual({ a: { b: 2 } });
  });

  it("does not get confused by braces inside strings", () => {
    const raw = '{"note": "a } b { c"}';
    expect(extractJson(raw)).toEqual({ note: "a } b { c" });
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });

  // --- repair pass: malformations small local models routinely emit ---------

  it("repairs a trailing comma in an object", () => {
    expect(extractJson('{"a": 1, "b": 2,}')).toEqual({ a: 1, b: 2 });
  });

  it("repairs a trailing comma in an array", () => {
    expect(extractJson('{"xs": [1, 2, 3,]}')).toEqual({ xs: [1, 2, 3] });
  });

  it("repairs single-quoted keys and strings", () => {
    expect(extractJson("{'a': 'hello', 'b': 2}")).toEqual({
      a: "hello",
      b: 2,
    });
  });

  it("repairs unquoted keys", () => {
    expect(extractJson("{a: 1, b: 2}")).toEqual({ a: 1, b: 2 });
  });

  it("repairs Python-style literals", () => {
    expect(extractJson('{"ok": True, "no": False, "x": None}')).toEqual({
      ok: true,
      no: false,
      x: null,
    });
  });

  it("closes a truncated object (hit the token cap mid-value)", () => {
    const raw = '{"questions": [{"prompt": "What is BGP?", "answer": "a routing';
    const out = extractJson(raw) as {
      questions: { prompt: string; answer: string }[];
    };
    expect(out.questions[0]?.prompt).toBe("What is BGP?");
  });

  it("closes a truncated array of objects", () => {
    const raw = '[{"q": "one"}, {"q": "two"}, {"q": "thr';
    const out = extractJson(raw) as { q: string }[];
    expect(out[0]?.q).toBe("one");
    expect(out[1]?.q).toBe("two");
  });

  it("strips // comments the model added", () => {
    const raw = '{\n  "a": 1, // the first\n  "b": 2\n}';
    expect(extractJson(raw)).toEqual({ a: 1, b: 2 });
  });

  it("repairs a fenced block that also has a trailing comma", () => {
    const raw = "```json\n{\n  \"a\": [1, 2,],\n}\n```";
    expect(extractJson(raw)).toEqual({ a: [1, 2] });
  });

  it("prefers the fast path and never mangles valid JSON", () => {
    const clean = { a: 1, s: "it's fine, really: {see}", xs: [1, 2, 3] };
    expect(extractJson(JSON.stringify(clean))).toEqual(clean);
  });
});

describe("intakeSchema", () => {
  const valid = {
    title: "Sopravvivere al colloquio Network & Security",
    lang: "it",
    objective:
      "Non diventare ingegnere BGP: capire di cosa parlano e dire dove sei forte.",
    domain: "networking & security da provider",
    startLevel: "forte su Linux e firewall, mai gestito BGP",
    deadline: "giovedì 10:30",
    budgetMinutes: 480,
    concretenessRule:
      "Ogni concetto astratto deve dire dove sta fisicamente e chi paga.",
    candidateConcepts: [
      {
        title: "BGP",
        summary: "Come le reti si annunciano le rotte a vicenda.",
        priority: "critical",
        estimatedMinutes: 120,
        depthLevel: 2,
      },
      {
        title: "OSPF",
        summary: "Routing interno all'edificio.",
        priority: "high",
        estimatedMinutes: 45,
        depthLevel: 1,
      },
      {
        title: "Prefissi e CIDR",
        summary: "Come si scrivono i blocchi di indirizzi.",
        priority: "high",
        estimatedMinutes: 20,
        depthLevel: 0,
      },
    ],
  };

  it("accepts a well-formed intake", () => {
    expect(intakeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an invalid priority", () => {
    const bad = {
      ...valid,
      candidateConcepts: [
        { ...valid.candidateConcepts[0], priority: "urgent" },
        ...valid.candidateConcepts.slice(1),
      ],
    };
    expect(intakeSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a depthLevel out of range", () => {
    const bad = {
      ...valid,
      candidateConcepts: [
        { ...valid.candidateConcepts[0], depthLevel: 7 },
        ...valid.candidateConcepts.slice(1),
      ],
    };
    expect(intakeSchema.safeParse(bad).success).toBe(false);
  });

  it("requires at least three concepts", () => {
    const bad = { ...valid, candidateConcepts: valid.candidateConcepts.slice(0, 1) };
    expect(intakeSchema.safeParse(bad).success).toBe(false);
  });
});
