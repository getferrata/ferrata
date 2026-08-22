import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PER_CALL_MARKER, splitPrompt } from "@/lib/llm/run";

/**
 * The author's interview answers have to reach the page.
 *
 * They did not. Intake read them, used them to plan the course, and that was
 * the end of it: write_module and write_questions were never given them, so
 * every module in every course was written from the material and a one-line
 * objective. The product's claim is that what makes a course worth more than
 * its documents is the knowledge that is not in the documents, and that
 * knowledge stopped at the planner.
 *
 * The visible symptom, from a benchmark run: architecture.md says the Postgres
 * failover pauses writes for about ten seconds, the author's answers say ten is
 * the paper figure and thirty is what they have measured under load, and the
 * module said ten. Nothing had gone wrong. The writer had simply never been
 * told.
 */

const PROMPTS = {
  write_module: "src/lib/llm/tasks/write_module/prompt.md",
  write_questions: "src/lib/llm/tasks/write_questions/prompt.md",
} as const;

const read = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), "utf8");

describe("the interview answers reach the stages that write the course", () => {
  it.each(Object.entries(PROMPTS))(
    "%s asks for them",
    (_task, path) => {
      // render() throws on a variable the caller did not supply, so a prompt
      // holding this placeholder cannot be called without the context being
      // passed: the wiring cannot rot back to silence.
      expect(read(path)).toContain("{{authorContext}}");
    },
  );

  it.each(Object.entries(PROMPTS))(
    "%s keeps them in the cached half of the prompt",
    (_task, path) => {
      // Course-level and identical on every module, so it belongs above the
      // marker. Below it, the same paragraphs would be paid for once per module
      // at full price instead of once per course at a tenth.
      const text = read(path);
      expect(text.indexOf("{{authorContext}}")).toBeLessThan(
        text.indexOf(PER_CALL_MARKER),
      );
    },
  );

  it("puts the answers in the system prompt, where trusted text belongs", () => {
    // The material is imported and untrusted and rides in a user turn. These
    // are the author's own words, like the brief, and the distinction is the
    // whole reason one can be trusted to correct the other.
    const rendered = read(PROMPTS.write_module).replace(
      "{{authorContext}}",
      "MARKER-FROM-THE-AUTHOR",
    );
    const system = splitPrompt(rendered);
    expect(typeof system === "string" ? system : system.stable).toContain(
      "MARKER-FROM-THE-AUTHOR",
    );
  });
});

describe("the rule for when the two disagree", () => {
  const text = read(PROMPTS.write_module);

  it("says to write both and attribute, not to pick one silently", () => {
    // The decision this encodes: the author can be wrong too, so answers that
    // always overwrite the material would teach somebody's memory instead of
    // the system. And a reader who meets the document one day has to recognise
    // it. So both, attributed.
    expect(text).toContain("write both and say which is");
    expect(text).toMatch(/Do not silently keep the document/);
    expect(text).toMatch(/Do not silently replace it/);
  });

  it("still tells the writer the material beats its own guesses", () => {
    // Unchanged and load-bearing: general knowledge losing to the material is
    // what keeps a module from inventing. Only a human author outranks it.
    expect(text).toContain("the material wins");
  });
});
