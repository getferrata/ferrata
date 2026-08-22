import { describe, expect, it } from "vitest";
import { verifyCodeFidelity } from "@/lib/llm/tasks/write_module/verify";

/**
 * Code in a module has to be the code in the material.
 *
 * The promise of a course built from a codebase is that you will know it as if
 * you had written it, and a snippet that is subtly wrong breaks that promise
 * completely. Subtly wrong is also the likely shape: a model reproducing a
 * function it was shown gets it right nearly always, and the rare miss is a
 * renamed variable or a flipped comparison, which reads perfectly and teaches
 * the opposite of the truth. Nothing else in the pipeline would catch it,
 * because a judge reads it as fluent and correct.
 */

const AGENT = `
export function decide(input: Signal, budget: number): Action {
  const score = weigh(input.strength, input.age);
  if (score > budget) {
    return { kind: "escalate", reason: "over budget" };
  }
  return { kind: "hold", reason: "within budget" };
}
`;

const material = [{ text: AGENT }];

function fence(tag: string, body: string): string {
  return ["Some prose.", "", "```" + tag, body.trim(), "```", "", "More prose."].join("\n");
}

describe("verifyCodeFidelity", () => {
  it("passes a block quoted exactly", () => {
    const r = verifyCodeFidelity(fence("ts", AGENT), material);
    expect(r.hard).toEqual([]);
    expect(r.soft).toEqual([]);
  });

  it("passes a quotation that only differs in indentation", () => {
    // Excerpting almost always reindents. Being strict about leading spaces
    // would fail on every correct module and teach everyone to ignore this.
    const reindented = AGENT.split("\n").map((l) => l.trimStart()).join("\n");
    expect(verifyCodeFidelity(fence("ts", reindented), material).hard).toEqual([]);
  });

  it("catches a renamed variable inside an otherwise real quotation", () => {
    const corrupted = AGENT.replace("const score = weigh(", "const total = weigh(");
    const r = verifyCodeFidelity(fence("ts", corrupted), material);
    expect(r.hard).toHaveLength(1);
    expect(r.hard[0]).toContain("not in it as written");
    expect(r.hard[0]).toContain("const total = weigh");
  });

  it("catches a flipped comparison, which is the dangerous one", () => {
    const corrupted = AGENT.replace("score > budget", "score < budget");
    const r = verifyCodeFidelity(fence("ts", corrupted), material);
    expect(r.hard).toHaveLength(1);
  });

  it("only warns about a block that is the model's own illustration", () => {
    // Nothing in common with the material: an example of what a wrong call
    // looks like, a minimal sketch. Legitimate often enough that blocking it
    // would cost a paid repair on a good module.
    const own = [
      "const client = new Thing({ retries: 3 });",
      "await client.connect('localhost');",
      "console.log('this is my own example, not your code');",
    ].join("\n");
    const r = verifyCodeFidelity(fence("ts", own), material);
    expect(r.hard).toEqual([]);
    expect(r.soft).toHaveLength(1);
    expect(r.soft[0]).toContain("matches nothing in the material");
  });

  it("ignores a fence that is not tagged as code", () => {
    // An ascii diagram in an untagged fence is allowed by the writing prompt,
    // and guessing that it is code costs a repair on a correct module.
    const diagram = ["  +------+      +------+", "  | edge | ---> | core |", "  +------+      +------+"].join("\n");
    const r = verifyCodeFidelity(fence("", diagram), material);
    expect(r.hard).toEqual([]);
    expect(r.soft).toEqual([]);
  });

  it("ignores a block too short to judge", () => {
    const r = verifyCodeFidelity(fence("ts", "const x = somethingEntirelyNew();"), material);
    expect(r.hard).toEqual([]);
    expect(r.soft).toEqual([]);
  });

  it("says nothing when the course has no material", () => {
    expect(verifyCodeFidelity(fence("ts", AGENT), [])).toEqual({ hard: [], soft: [] });
  });

  it("does not count braces and punctuation as matches", () => {
    // Without this the denominator fills with lines that match everywhere and
    // any invented block clears the threshold.
    const braces = ["}", "  }", "});", "  {", "]", ")"].join("\n");
    const r = verifyCodeFidelity(fence("ts", braces), material);
    expect(r.hard).toEqual([]);
    expect(r.soft).toEqual([]);
  });

  it("reports each bad block separately", () => {
    const one = AGENT.replace("const score", "const alpha");
    const two = AGENT.replace("return { kind: \"hold\"", "return { kind: \"stop\"");
    const body = [fence("ts", one), fence("ts", two)].join("\n\n");
    expect(verifyCodeFidelity(body, material).hard).toHaveLength(2);
  });
});
