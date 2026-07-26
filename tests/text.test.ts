import { describe, expect, it } from "vitest";
import { plainText } from "@/lib/text";

describe("plainText", () => {
  it("strips inline code, bold and emphasis markers", () => {
    expect(plainText("Quando `recon` ti sveglia")).toBe("Quando recon ti sveglia");
    expect(plainText("**Idempotenza** conta")).toBe("Idempotenza conta");
    expect(plainText("__forte__ e *chiaro*")).toBe("forte e chiaro");
  });

  it("drops a stray leading heading marker", () => {
    expect(plainText("## Titolo")).toBe("Titolo");
  });

  it("leaves clean text untouched", () => {
    const s = "Il ledger append-only: le due righe che fanno zero";
    expect(plainText(s)).toBe(s);
  });

  it("does not eat multiplication or mid-word asterisks", () => {
    expect(plainText("a * b + c")).toBe("a * b + c");
  });
});
