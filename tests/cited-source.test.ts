import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A module teaches what the material says. It does not point at it.
 *
 * Found by reading a finished course, twice, and the second reading corrected
 * the first. The visible symptom was a module quoting its source before saying
 * what that source was, and the repair for that was to introduce the document.
 * Wrong repair. The reader has no document to be introduced to: the author had
 * the material, the student has the module and nothing else. A sentence built
 * on "the document describes a case where…" leaves them outside the thing they
 * were supposed to learn, and a course made of those reads as disconnected
 * because it is: the connective tissue is in a file they will never open.
 *
 * The reference standard settles it. It carries no citations at all, in any
 * form, across every module. It just teaches.
 *
 * So the citation stays as provenance, for an author checking a course against
 * their own material, and the prose must stand without it. That is the rule
 * these check for, on the prompt file, because that is where the instruction
 * lives and where it would quietly be lost: a prompt is edited far more often
 * than the code around it.
 */
const prompt = readFileSync(
  resolve(__dirname, "..", "src", "lib", "llm", "tasks", "write_module", "prompt.md"),
  "utf8",
);

describe("a module teaches the material rather than referring to it", () => {
  it("says the reader has not seen the documents", () => {
    expect(prompt.toLowerCase()).toContain("never seen these documents");
  });

  it("gives the mechanical test: the sentence must survive losing the marker", () => {
    // A rule a writer can apply without judgement. "Be clear" is not one.
    expect(prompt.toLowerCase()).toMatch(
      /delete the `\[source: …\]` marker.*sentence must still teach/s,
    );
  });

  it("names the phrasings that fail, rather than only the principle", () => {
    for (const bad of [
      "as the attached runbook explains",
      "the document says that",
      "according to the material",
    ]) {
      expect(prompt.toLowerCase(), bad).toContain(bad);
    }
  });

  it("calls the citation provenance, not content", () => {
    expect(prompt.toLowerCase()).toContain("provenance, never the content");
  });

  it("still allows a quotation where the exact words are the point", () => {
    // A command to type or a threshold is worth quoting. Forbidding that
    // outright would trade one kind of vagueness for another.
    expect(prompt.toLowerCase()).toContain("exact words are the point");
  });

  it("keeps the rule that a name is copied exactly", () => {
    expect(prompt).toMatch(/character for character/i);
  });

  it("no longer tells the writer to introduce the document", () => {
    // The superseded repair. Left in, it pulls in the opposite direction:
    // introducing a document invites leaning on it.
    expect(prompt.toLowerCase()).not.toContain("introduce it once");
  });
});
