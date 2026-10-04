import { describe, expect, it } from "vitest";
import { placeholderTitle } from "@/lib/course/placeholder-title";

describe("the title shown while the plan is reviewed", () => {
  it("is the whole brief when it is short", () => {
    expect(placeholderTitle("Onboard the on-call engineer")).toBe("Onboard the on-call engineer");
  });

  it("is the first sentence, not the first 80 characters", () => {
    // This brief used to become "...at Acme Payments. They".
    const brief =
      "Onboard a new backend engineer joining the checkout team at Acme Payments. They start Monday and take their first on-call shift in week two.";
    expect(placeholderTitle(brief)).toBe(
      "Onboard a new backend engineer joining the checkout team at Acme Payments.",
    );
  });

  it("cuts a long sentence between words and says it was cut", () => {
    const brief =
      "Onboard a new backend engineer joining the checkout team at Acme Payments including the runbook and on-call rota and everything else";
    const t = placeholderTitle(brief);
    expect(t.endsWith("…")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(81);
    // Whole words only: what precedes the ellipsis is a prefix of the brief ending at a word.
    const body = t.slice(0, -1);
    expect(brief.startsWith(body)).toBe(true);
    expect(brief[body.length]).toBe(" ");
  });

  it("uses the first line of a multi-line brief", () => {
    expect(placeholderTitle("Handover: payments\n\nLong notes follow here that must not be in a title.")).toBe(
      "Handover: payments",
    );
  });

  it("never ends inside a protection placeholder", () => {
    // No space to cut at, so the cut is hard and lands inside the placeholder.
    const brief = "x".repeat(70) + "⟨cxt:de776c1a9f3b2e41⟩" + "y".repeat(30);
    const t = placeholderTitle(brief);
    expect(t).not.toContain("⟨");
    expect(t).toBe("x".repeat(70) + "…");
  });

  it("copes with nothing but whitespace", () => {
    expect(placeholderTitle("   \n  ")).toBe("");
  });
});
