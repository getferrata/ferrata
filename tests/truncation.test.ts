import { describe, expect, it } from "vitest";
import { looksTruncated } from "@/lib/llm/truncation";

describe("looksTruncated", () => {
  it("flags a body that stops mid-sentence", () => {
    // The exact tell from a real cut-off capstone module: ends on a word, no
    // closing punctuation.
    expect(
      looksTruncated(
        "Ogni azione ha un costo, ma nell'incidente di novembre 2024 il pool vuoto",
      ),
    ).toBe(true);
  });

  it("flags a body ending on a comma or a bare digit", () => {
    expect(looksTruncated("il rollout si ferma dopo circa,")).toBe(true);
    expect(looksTruncated("il 60% delle richieste per circa 8")).toBe(true);
  });

  it("accepts a body that ends on sentence punctuation", () => {
    expect(looksTruncated("Controlla il pool prima di toccare il gateway.")).toBe(
      false,
    );
    expect(looksTruncated("E ora? Guarda, non agire!")).toBe(false);
  });

  it("accepts markdown closers: table row, code fence, bracket", () => {
    expect(looksTruncated("| a | b |")).toBe(false);
    expect(looksTruncated("```")).toBe(false);
    expect(looksTruncated("...da chiarire col team.]")).toBe(false);
  });

  it("ignores trailing whitespace and newlines", () => {
    expect(looksTruncated("finito.\n\n  ")).toBe(false);
    expect(looksTruncated("a metà frase   \n")).toBe(true);
  });

  it("does not flag an empty body (a different check owns that)", () => {
    expect(looksTruncated("")).toBe(false);
    expect(looksTruncated("   \n ")).toBe(false);
  });
});
