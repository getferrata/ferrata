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

describe("what a cached token costs", () => {
  const model = "claude-sonnet-5"; // $3 per 1M in, $15 per 1M out

  it("prices a cache read at a tenth of the input rate", () => {
    const full = estimateCostUsd("anthropic", model, 1_000_000, 0);
    const cached = estimateCostUsd("anthropic", model, 1_000_000, 0, {
      readTokens: 1_000_000,
      writeTokens: 0,
    });
    expect(full).toBeCloseTo(3, 6);
    expect(cached).toBeCloseTo(0.3, 6);
  });

  it("prices a cache write above the normal rate, because it is", () => {
    // The write premium is why caching is not free to switch on: a prefix
    // written once and never read costs more than not caching at all.
    const written = estimateCostUsd("anthropic", model, 1_000_000, 0, {
      readTokens: 0,
      writeTokens: 1_000_000,
    });
    expect(written).toBeCloseTo(3.75, 6);
  });

  it("charges full price for the part that was not cached", () => {
    // 500k full, 400k read, 100k written.
    const usd = estimateCostUsd("anthropic", model, 1_000_000, 0, {
      readTokens: 400_000,
      writeTokens: 100_000,
    });
    expect(usd).toBeCloseTo(1.5 + 0.12 + 0.375, 6);
  });

  it("is unchanged when the provider reports no cache at all", () => {
    expect(estimateCostUsd("anthropic", model, 1000, 100)).toBe(
      estimateCostUsd("anthropic", model, 1000, 100, {
        readTokens: 0,
        writeTokens: 0,
      }),
    );
  });

  it("never invents a discount from impossible numbers", () => {
    // tokensIn carries the cached spans, so cached-greater-than-total means a
    // provider is contradicting itself. Clamped rather than trusted: the
    // alternative is pricing a negative number of tokens.
    const usd = estimateCostUsd("anthropic", model, 1000, 0, {
      readTokens: 9_000_000,
      writeTokens: 0,
    });
    expect(usd).toBeGreaterThanOrEqual(0);
  });

  it("stays free on a local model whatever the cache says", () => {
    expect(
      estimateCostUsd("ollama", "llama3", 1_000_000, 1_000_000, {
        readTokens: 500_000,
        writeTokens: 0,
      }),
    ).toBe(0);
  });
});
