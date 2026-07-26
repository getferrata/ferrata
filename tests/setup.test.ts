import { describe, expect, it } from "vitest";
import { setupReason } from "@/lib/llm/setup";
import {
  courseCostUsd,
  estimateCourseCost,
  formatUsd,
} from "@/lib/llm/estimate";

describe("setupReason", () => {
  it("any hosted key counts as configured", () => {
    expect(setupReason({ ANTHROPIC_API_KEY: "sk-a" }, false)).toBe("key");
    expect(setupReason({ OPENAI_API_KEY: "sk-o" }, false)).toBe("key");
    expect(setupReason({ GROQ_API_KEY: "gsk_x" }, false)).toBe("key");
  });

  it("an explicit local override counts even when unreachable right now", () => {
    expect(setupReason({ FERRATA_LLM_OVERRIDE: "ollama" }, false)).toBe(
      "local-explicit",
    );
  });

  it("a running local server counts", () => {
    expect(setupReason({}, true)).toBe("local-running");
  });

  it("nothing configured and no local server: not configured", () => {
    expect(setupReason({}, false)).toBeNull();
  });
});

describe("course cost estimate", () => {
  it("local models are free", () => {
    const est = estimateCourseCost("ollama", "qwen2.5:7b-instruct");
    expect(courseCostUsd(est, 10)).toBe(0);
    expect(formatUsd(courseCostUsd(est, 10))).toBe("free");
  });

  it("hosted models scale with module count", () => {
    const est = estimateCourseCost("anthropic", "claude-sonnet-5");
    const five = courseCostUsd(est, 5);
    const ten = courseCostUsd(est, 10);
    expect(five).toBeGreaterThan(0);
    expect(ten).toBeGreaterThan(five);
    // order of magnitude: a 10-module course on a top model stays in single-digit dollars
    expect(ten).toBeLessThan(5);
  });

  it("formats cents and dollars sanely", () => {
    expect(formatUsd(0.004)).toBe("<$0.01");
    expect(formatUsd(0.42)).toBe("$0.42");
    expect(formatUsd(2.1)).toBe("$2.10");
  });
});
