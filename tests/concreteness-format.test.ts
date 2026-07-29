import { describe, expect, it } from "vitest";
import {
  BODY_DELIMITER,
  parseConcretenessOutput,
  renderConcretenessOutput,
} from "@/lib/llm/tasks/concreteness_pass/format";
import { bodyOnlyParser } from "@/lib/llm/tasks/body_delimiter";
import { concretenessSchema } from "@/lib/llm/tasks/concreteness_pass/schema";

const LONG = "x".repeat(500);

describe("concreteness_pass delimiter format", () => {
  it("parses a notes block and a raw markdown body", () => {
    const out = parseConcretenessOutput(
      `NOTES:\n- named the pool from the runbook\n- declared abstract: no physical place\n${BODY_DELIMITER}\n## Idea\n\nA body with "quotes", backslashes \\ and\nnewlines, unescaped.`,
    ) as { bodyMd: string; notes: string[] };
    expect(out.notes).toEqual([
      "named the pool from the runbook",
      "declared abstract: no physical place",
    ]);
    // Verbatim: there is no JSON escaping to undo.
    expect(out.bodyMd).toContain('"quotes"');
    expect(out.bodyMd).toContain("\\");
  });

  it("accepts the bullet styles a model actually uses", () => {
    const out = parseConcretenessOutput(
      `NOTES:\n* star\n1. numbered\n2) parenthesised\n+ plus\n${BODY_DELIMITER}\nbody`,
    ) as { notes: string[] };
    expect(out.notes).toEqual(["star", "numbered", "parenthesised", "plus"]);
  });

  it("keeps a body whose notes block is empty or malformed", () => {
    // Notes are advisory: they are logged and never gate acceptance, so a
    // malformed head must not cost a paid retry of a body that is fine.
    const out = parseConcretenessOutput(
      `Here are my changes, in prose instead of bullets.\n${BODY_DELIMITER}\n${LONG}`,
    ) as { bodyMd: string; notes: string[] };
    expect(out.notes).toEqual([]);
    expect(concretenessSchema.safeParse(out).success).toBe(true);
  });

  it("round-trips through render", () => {
    const rendered = renderConcretenessOutput(["one"], "## H\n\nbody");
    expect(rendered).toContain(BODY_DELIMITER);
    expect(parseConcretenessOutput(rendered)).toMatchObject({
      notes: ["one"],
      bodyMd: "## H\n\nbody",
    });
  });

  it("falls back to JSON when the delimiter is absent", () => {
    const out = parseConcretenessOutput(
      JSON.stringify({ bodyMd: LONG, notes: ["kept"] }),
    );
    expect(out).toMatchObject({ bodyMd: LONG, notes: ["kept"] });
  });

  it("fails loudly when there is neither a delimiter nor JSON", () => {
    expect(() =>
      parseConcretenessOutput("Sure, here is the edited module."),
    ).toThrow();
  });

  it("does not lose a body that mentions the delimiter later on", () => {
    const out = parseConcretenessOutput(
      `NOTES:\n- a\n${BODY_DELIMITER}\nfirst\n\nthe marker ${BODY_DELIMITER} appears in prose`,
    ) as { bodyMd: string };
    expect(out.bodyMd).toContain(`the marker ${BODY_DELIMITER} appears in prose`);
  });

  it("caps the notes list instead of letting it grow unbounded", () => {
    const notes = Array.from({ length: 60 }, (_, i) => `- note ${i}`).join("\n");
    const out = parseConcretenessOutput(
      `NOTES:\n${notes}\n${BODY_DELIMITER}\n${LONG}`,
    ) as { notes: string[] };
    expect(out.notes).toHaveLength(40);
    expect(concretenessSchema.safeParse(out).success).toBe(true);
  });
});

describe("body-only stages (schedule, glossary)", () => {
  it("takes everything after the marker as the field", () => {
    const out = bodyOnlyParser("glossaryMd")(
      `---BODY---\n**VIP**: the address they answer on.\n\n**Pool**: the healthy set.`,
    ) as { glossaryMd: string };
    expect(out.glossaryMd).toContain("**VIP**");
    expect(out.glossaryMd).not.toContain(BODY_DELIMITER);
  });

  it("drops a preamble instead of folding it into the document", () => {
    // Taking the whole reply as the body would put "Here is the glossary you
    // asked for" inside the glossary, and nothing downstream would catch it.
    const out = bodyOnlyParser("glossaryMd")(
      `Sure, here is the glossary you asked for.\n---BODY---\n**VIP**: the address.`,
    ) as { glossaryMd: string };
    expect(out.glossaryMd).toBe("**VIP**: the address.");
  });

  it("falls back to JSON, so a model that ignores the format is not a paid retry", () => {
    const out = bodyOnlyParser("scheduleMd")(
      JSON.stringify({ scheduleMd: "## Day 1" }),
    );
    expect(out).toMatchObject({ scheduleMd: "## Day 1" });
  });

  it("fails loudly when there is neither a delimiter nor JSON", () => {
    expect(() => bodyOnlyParser("scheduleMd")("I could not do that.")).toThrow();
  });
});
