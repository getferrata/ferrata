import { describe, expect, it } from "vitest";
import {
  BODY_DELIMITER,
  bodyOnlyParser,
} from "@/lib/llm/tasks/body_delimiter";

/**
 * The delimiter format, as used by the stages whose answer is one long markdown
 * document: write_module, schedule and glossary. The concreteness pass used it
 * too until its answer stopped being a document and became a list of edits.
 */
describe("body-only stages (schedule, glossary)", () => {
  it("takes everything after the marker as the field", () => {
    const out = bodyOnlyParser("glossaryMd")(
      `${BODY_DELIMITER}\n**VIP**: the address they answer on.`,
    ) as { glossaryMd: string };
    expect(out.glossaryMd).toBe("**VIP**: the address they answer on.");
  });

  it("drops a preamble instead of folding it into the document", () => {
    const out = bodyOnlyParser("glossaryMd")(
      `Sure, here is the glossary you asked for.\n${BODY_DELIMITER}\n**VIP**: the address.`,
    ) as { glossaryMd: string };
    expect(out.glossaryMd).toBe("**VIP**: the address.");
  });

  it("falls back to JSON, so a model that ignores the format is not a paid retry", () => {
    expect(
      bodyOnlyParser("scheduleMd")(JSON.stringify({ scheduleMd: "## Day 1" })),
    ).toMatchObject({ scheduleMd: "## Day 1" });
  });

  it("fails loudly when there is neither a delimiter nor JSON", () => {
    expect(() => bodyOnlyParser("scheduleMd")("I could not do that.")).toThrow();
  });

  it("ignores the marker when it is not alone on its line", () => {
    // Uploaded material describing a message format can carry the literal
    // string. Splitting on it would cut the document at the content's marker.
    const out = bodyOnlyParser("glossaryMd")(
      `${BODY_DELIMITER}\n**Multipart**: a body is introduced by ---BODY--- inline.`,
    ) as { glossaryMd: string };
    expect(out.glossaryMd).toBe(
      "**Multipart**: a body is introduced by ---BODY--- inline.",
    );
  });

  it("tolerates trailing whitespace on the marker line", () => {
    const out = bodyOnlyParser("scheduleMd")(
      `${BODY_DELIMITER}   \n## Day 1`,
    ) as { scheduleMd: string };
    expect(out.scheduleMd).toBe("## Day 1");
  });
});
