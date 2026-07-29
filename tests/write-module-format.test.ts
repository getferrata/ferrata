import { describe, expect, it } from "vitest";
import {
  BODY_DELIMITER,
  parseModuleOutput,
  renderModuleOutput,
} from "@/lib/llm/tasks/write_module/format";

describe("write_module delimiter format", () => {
  it("parses a title line and a raw markdown body", () => {
    const out = parseModuleOutput(
      "TITLE: The edge gateway\n---BODY---\n## Idea\n\nA body with \"quotes\", backslashes \\ and\nnewlines, unescaped.",
    );
    expect(out).toMatchObject({
      title: "The edge gateway",
      bodyMd: expect.stringContaining("## Idea"),
    });
    // The body is kept verbatim: no JSON escaping to undo.
    expect((out as { bodyMd: string }).bodyMd).toContain('"quotes"');
    expect((out as { bodyMd: string }).bodyMd).toContain("\\");
  });

  it("is tolerant of a missing TITLE: label and surrounding whitespace", () => {
    const out = parseModuleOutput(
      "  The title\n---BODY---\n  body text  ",
    ) as { title: string; bodyMd: string };
    expect(out.title).toBe("The title");
    expect(out.bodyMd).toBe("body text");
  });

  it("round-trips through render", () => {
    const rendered = renderModuleOutput("T", "## H\n\nbody");
    expect(rendered).toContain(BODY_DELIMITER);
    expect(parseModuleOutput(rendered)).toMatchObject({
      title: "T",
      bodyMd: "## H\n\nbody",
    });
  });

  it("fails loudly when there is neither a delimiter nor JSON", () => {
    // Wrapping the whole reply as a body would smuggle any preamble into the
    // module and rely on a distant schema rule to catch it. Throwing lets the
    // retry loop tell the model what was wrong.
    expect(() => parseModuleOutput("Sure! Here is the module you asked for.")).toThrow();
  });

  it("falls back to JSON when the delimiter is absent", () => {
    const out = parseModuleOutput('{"title":"J","bodyMd":"from json"}');
    expect(out).toMatchObject({ title: "J", bodyMd: "from json" });
  });

  it("falls back to JSON inside a code fence", () => {
    const out = parseModuleOutput(
      '```json\n{"title":"F","bodyMd":"fenced"}\n```',
    );
    expect(out).toMatchObject({ title: "F", bodyMd: "fenced" });
  });

  it("does not lose a body that contains the delimiter word later on", () => {
    // Only the first delimiter splits; a later mention stays in the body.
    const out = parseModuleOutput(
      "TITLE: X\n---BODY---\nfirst\n\nthe marker ---BODY--- appears in prose",
    ) as { bodyMd: string };
    expect(out.bodyMd).toContain("the marker ---BODY--- appears in prose");
  });
});
