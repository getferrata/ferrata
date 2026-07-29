import { describe, expect, it } from "vitest";
import { estimateCostUsd, isPriceKnown } from "@/lib/llm/cost";

describe("pricing a call", () => {
  it("uses the real rate for a model it knows", () => {
    // 1M in + 1M out on a known model, so the arithmetic is readable.
    const usd = estimateCostUsd("anthropic", "claude-sonnet-5", 1_000_000, 1_000_000);
    expect(usd).toBeCloseTo(18, 5); // 3 in + 15 out
    expect(isPriceKnown("anthropic", "claude-sonnet-5")).toBe(true);
  });

  it("is free for a local model", () => {
    expect(estimateCostUsd("ollama", "qwen2.5:3b", 1_000_000, 1_000_000)).toBe(0);
    expect(isPriceKnown("ollama", "anything-at-all")).toBe(true);
  });

  it("fails closed on a model it has never heard of", () => {
    // The settings page lists models pulled live from the provider, so an
    // unlisted model is routine. Pricing it at zero made the credit ceiling
    // unreachable: spend summed to nothing and the limit never fired, which is
    // worse than having no limit, because the operator believes they have one.
    const usd = estimateCostUsd("openai", "some-model-shipped-last-week", 1_000_000, 0);
    expect(usd).toBeGreaterThan(0);
    expect(isPriceKnown("openai", "some-model-shipped-last-week")).toBe(false);
  });

  it("prices the unknown at the most expensive rate it knows", () => {
    const unknown = estimateCostUsd("openai", "brand-new", 1_000_000, 1_000_000);
    const dearest = estimateCostUsd("anthropic", "claude-opus-5", 1_000_000, 1_000_000);
    expect(unknown).toBeCloseTo(dearest, 5);
  });

  it("scales with tokens rather than being a flat charge", () => {
    const small = estimateCostUsd("openai", "gpt-4o", 1_000, 1_000);
    const large = estimateCostUsd("openai", "gpt-4o", 10_000, 10_000);
    expect(large).toBeCloseTo(small * 10, 8);
  });
});
